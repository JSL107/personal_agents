import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AnalyzeJdGapUsecase } from '../../../agent/career-mate/application/analyze-jd-gap.usecase';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
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

const DEFAULT_MATCH_THRESHOLD = 60;
const DEFAULT_TOP_N = 2;

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
    // env 는 아직 app.config.ts 에 없다(Task 17 예정) — 미설정이면 꺼진 상태가 기본이다.
    if (this.configService.get<string>('JOB_FEED_ENABLED') !== 'true') {
      return { skip: true };
    }
    const topN = this.readNumber('JOB_FEED_GAP_ANALYSIS_TOP_N', DEFAULT_TOP_N);
    if (topN <= 0) {
      return { skip: true };
    }
    const threshold = this.readNumber(
      'JOB_FEED_MATCH_THRESHOLD',
      DEFAULT_MATCH_THRESHOLD,
    );

    // gapAgentRunId 가 비어 있는 것만 고른다 — 없으면 매일 같은 공고를 다시 분석한다.
    const candidates = await this.repository.findGapCandidates(threshold, topN);
    if (candidates.length === 0) {
      return { skip: true };
    }

    const summaries: string[] = [];
    for (const candidate of candidates) {
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

    return {
      skip: false,
      summaryText: `*공고 갭 분석*\n${summaries.join('\n\n')}`,
    };
  }

  // env 가 아직 app.config.ts 에 선언되지 않아(Task 17) class-transformer 의
  // enableImplicitConversion 이 이 키들에 적용되지 않는다 — ConfigService.get<number>()
  // 를 믿지 않고 문자열로 읽어 직접 파싱한다.
  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key);
    if (raw === undefined || raw.trim().length === 0) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      this.logger.warn(`${key} 값이 숫자가 아닙니다 — 기본값 ${fallback} 사용`);
      return fallback;
    }
    return parsed;
  }
}
