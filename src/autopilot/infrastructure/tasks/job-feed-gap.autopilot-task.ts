import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AnalyzeJdGapUsecase } from '../../../agent/career-mate/application/analyze-jd-gap.usecase';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { MODEL_ROUTER_WORST_CASE_MS } from '../../../common/llm/llm-timeout.constant';
import { AUTOPILOT_WORKER_OPTIONS } from '../../../common/queue/worker-options.constant';
import { parseAvoidSkillTags } from '../../../job-feed/domain/avoid-skills';
import {
  JOB_POSTING_REPOSITORY_PORT,
  JobPostingRepositoryPort,
} from '../../../job-feed/domain/port/job-posting.repository.port';
import { escapeMrkdwn } from '../../../job-feed/infrastructure/job-feed.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 실측 분포 기준(job-feed.autopilot-task.ts 참조) — 코드 기본값을 .env.example 과 맞춘다.
const DEFAULT_MATCH_THRESHOLD = 80;
// 순차 모델 호출 1건의 worst-case(MODEL_ROUTER_WORST_CASE_MS=606초)가 이미 autopilot
// consumer lock 예산(AUTOPILOT_WORKER_OPTIONS.lockDuration=876초)의 60%보다 크다 —
// 기본값을 2로 두면 2건 순차 실행(최악 1,212초)이 예산을 넘겨 BullMQ 재시도를 유발한다
// (이 레포가 2026-07-26 에 겪은 12회 연쇄 재실행과 같은 계열). 기본은 1건만 돈다.
const DEFAULT_TOP_N = 1;

// 아래 경과 시간 가드와 짝을 이루는 안전 여유(60%) — 근거는 가드 상수 정의부 주석 참조.
const ELAPSED_BUDGET_SAFETY_RATIO = 0.6;
// autopilot consumer 의 실제 lock 예산(AUTOPILOT_WORKER_OPTIONS.lockDuration)의 60%를
// 누적 경과 시간의 안전 상한으로 둔다. 모델 호출 worst-case(MODEL_ROUTER_WORST_CASE_MS=606초)가
// 이미 그 60%(525.6초)보다 커서, 이 가드는 사실상 "같은 회차에 모델 호출을 두 번 이상
// 순차로 걸지 않는다"로 귀결된다 — 의도된 결과다. DEFAULT_TOP_N 을 1로 낮췄어도 env 로
// JOB_FEED_GAP_ANALYSIS_TOP_N 을 2까지 올릴 수 있으므로(app.config.ts @Max(2)), 그 경우에도
// 이 가드가 두 번째 호출을 막아 예산 초과를 방지한다. 첫 건은 무조건 시도한다(아래 run() 의
// index>0 분기) — 그러지 않으면 기본값 1건조차 "항상 스킵됨"이 돼 기능 자체가 죽는다.
const ELAPSED_BUDGET_MS =
  AUTOPILOT_WORKER_OPTIONS.lockDuration * ELAPSED_BUDGET_SAFETY_RATIO;

// 상위 후보만 모델로 갭 분석한다 — job-feed(수집·채점·아침 카드)와 분리한 이유는
// job-feed.autopilot-task.ts 상단 주석 참조(잠금 시간 예산 초과 방지).
@Injectable()
export class JobFeedGapAutopilotTask implements AutopilotTask {
  readonly id = 'job-feed-gap';
  private readonly logger = new Logger(JobFeedGapAutopilotTask.name);

  constructor(
    private readonly analyzeJdGap: AnalyzeJdGapUsecase,
    @Inject(JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: JobPostingRepositoryPort,
    private readonly configService: ConfigService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    // 미설정이면 꺼진 상태가 기본이다.
    if (this.configService.get<string>('JOB_FEED_ENABLED') !== 'true') {
      return { skip: true };
    }
    const topN =
      this.configService.get<number>('JOB_FEED_GAP_ANALYSIS_TOP_N') ??
      DEFAULT_TOP_N;
    if (topN <= 0) {
      return { skip: true };
    }
    const threshold =
      this.configService.get<number>('JOB_FEED_MATCH_THRESHOLD') ??
      DEFAULT_MATCH_THRESHOLD;

    // 알림에서 거르는 기피 기술이 갭 분석(모델 호출)에는 안 걸리면, "저장은 하되
    // 알림에서만 뺀다"는 목적이 알림 표면 두 곳 중 하나에서만 지켜진다 — 기피
    // 회사의 공고가 matchScore 순 정렬 맨 앞이면 그날 유일한 갭 분석이 정확히
    // 그 공고에 쓰일 수 있다(job-feed.autopilot-task.ts 와 같은 파싱을 쓴다).
    const { identified: avoidSkillTags, unmatched } = parseAvoidSkillTags(
      this.configService.get<string>('JOB_FEED_AVOID_SKILLS'),
    );
    if (unmatched.length > 0) {
      this.logger.warn(
        `JOB_FEED_AVOID_SKILLS 중 사전에 없는 항목(표기가 정확히 같은 공고만 걸린다): ${unmatched.join(', ')}`,
      );
    }

    // gapAgentRunId 가 비어 있는 것만 고른다 — 없으면 매일 같은 공고를 다시 분석한다.
    const candidates = await this.repository.findGapCandidates(
      threshold,
      topN,
      avoidSkillTags,
    );
    if (candidates.length === 0) {
      return { skip: true };
    }

    const summaries: string[] = [];
    const startedAt = Date.now();
    let stoppedByBudget = false;

    for (let index = 0; index < candidates.length; index += 1) {
      // 첫 건은 예산 판단 없이 무조건 시도한다 — 그러지 않으면 기본값(topN=1)조차
      // 매 회차 스킵되어 기능이 죽는다. 두 번째 건부터 "이 한 건을 더 돌리면 예산을
      // 넘길지"를 판단한다.
      if (index > 0) {
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs + MODEL_ROUTER_WORST_CASE_MS > ELAPSED_BUDGET_MS) {
          stoppedByBudget = true;
          break;
        }
      }

      const candidate = candidates[index];
      try {
        const outcome = await this.analyzeJdGap.execute({
          slackUserId: context.ownerSlackUserId,
          jdText: candidate.jdText ?? '',
          // 자동 경로 — 목표 공고에 쓰지 않고 주제 카드도 띄우지 않는다
          // (AnalyzeJdGapUsecase 의 isAutomated 분기 참조).
          origin: 'JOB_FEED',
          company: candidate.company,
          role: candidate.title,
          triggerType: TriggerType.AUTOPILOT_JOB_FEED_GAP_CRON,
        });
        await this.repository.saveGapAgentRunId(
          candidate.id,
          outcome.agentRunId,
        );
        summaries.push(
          `*${escapeMrkdwn(candidate.company)} — ${escapeMrkdwn(candidate.title)}*\n${outcome.result.fitSummary}\n부족: ${outcome.result.gaps.slice(0, 3).join(', ')}`,
        );
      } catch (error) {
        // 한 건이 실패해도 나머지를 계속한다. 쿼터 소진이면 그 사실이 카드에 남아야 한다.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `job-feed 갭 분석 실패 — ${candidate.company}: ${reason}`,
        );
        summaries.push(
          `⚠️ ${escapeMrkdwn(candidate.company)} 갭 분석 실패 — ${escapeMrkdwn(reason)}`,
        );
      }
    }

    if (stoppedByBudget) {
      // 조용히 멈추면 "왜 N건 중 일부만 분석됐지"를 나중에 못 찾는다 — 남은 건수와
      // 사유를 카드에 남긴다. 스킵된 후보는 gapAgentRunId 가 그대로 비어 있으므로
      // 다음 회차에 다시 후보로 잡힌다.
      const remaining = candidates.length - summaries.length;
      this.logger.warn(
        `job-feed 갭 분석 — 실행 시간 예산 초과 우려로 ${remaining}건 건너뜀`,
      );
      summaries.push(
        `⏱️ 남은 ${remaining}건은 실행 시간 예산 초과 우려로 다음 회차로 미룹니다.`,
      );
    }

    return {
      skip: false,
      summaryText: `*공고 갭 분석*\n${summaries.join('\n\n')}`,
    };
  }
}
