import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../../../preview-gate/domain/port/preview-action.repository.port';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  JudgeStudyApplicabilityUsecase,
  StudyApplicabilityRunResult,
} from '../../../study-brief-cron/application/judge-study-applicability.usecase';
import {
  JudgedApplyStudyBrief,
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../../../study-brief-cron/domain/port/study-brief.repository.port';
import { APPLICABILITY_VERDICT } from '../../../study-brief-cron/domain/study-applicability.type';
import {
  buildStudyApplyIssue,
  buildStudyApplyPreviewText,
} from '../../../study-brief-cron/domain/study-apply-issue.format';
import {
  GITHUB_REPO_PATTERN,
  StudyApplyIssuePayload,
} from '../../../study-brief-cron/domain/study-apply-issue.payload';
import {
  AutopilotPreviewRequest,
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

export const STUDY_APPLY_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 카드 없이 남은 APPLY 를 다시 찾는 창. 카드 TTL 과 같게 둬, 레포 설정을 일주일 안에 고치면
// 그 사이 판정된 제안이 카드로 나온다.
export const PENDING_CARD_LOOKBACK_MS = STUDY_APPLY_PREVIEW_TTL_MS;
// 한 회차에 모델을 부르는 판정은 1건. 모델 호출 1건의 최악(MODEL_ROUTER_WORST_CASE_MS=606초)이 이미
// autopilot worker lockDuration(876초)의 70% 라, 2건을 순차로 걸면 최악 1,212초로 예산을 넘겨 BullMQ 가
// stalled 로 보고 같은 job 을 다시 돌린다(job-feed-gap.autopilot-task.ts 의 DEFAULT_TOP_N=1 과 같은 근거).
// 하루 새 브리프는 1건이라 1건이면 그날 판정되고, 모델 없이 끝나는 판정(키워드·후보 없음)은 상한 밖이다.
export const MAX_MODEL_JUDGEMENTS_PER_RUN = 1;
// 반복 자체의 안전 상한. 48시간 창에 하루 1건이라 실제로는 2~3건이다.
const MAX_BRIEFS_PER_RUN = 10;

interface CollectedCards {
  lines: string[];
  previews: AutopilotPreviewRequest[];
}

// 오늘의 공부(09:30) → 적용 판정(10:30) → 딥다이브(11:00).
// 발행 job 과 분리한 이유: 발행 job 의 30분 처리 잠금·실패 알림에 닿을 경로를 없애기 위해서다.
// APPLY 가 아니면 조용히 끝낸다 — 판정 분포는 월간 운영 요약에서 본다.
//
// 판정 저장과 카드 생성은 한 트랜잭션이 아니다. 판정은 usecase 가 먼저 저장하고, 카드 행은 이 task 가
// 돌려준 preview 를 orchestrator 가 나중에 만든다. 그 사이가 끊기면(레포 설정 누락·형식 오류, task 예외,
// 카드 행 생성 실패) 저장된 APPLY 는 미판정 조회(`applicability IS NULL`)에서 빠진다. 그래서 새로 판정하기
// 전에 "APPLY 인데 카드 행이 한 번도 안 생긴 브리프" 를 먼저 집어 저장된 판정으로 카드만 다시 낸다.
// 카드 행이 있으면(상태 무관) 다시 내지 않는다 — 발송이 실패한 행까지 다시 내면 중복 발행이 된다.
@Injectable()
export class StudyApplicabilityAutopilotTask implements AutopilotTask {
  readonly id = 'study-applicability';
  private readonly logger = new Logger(StudyApplicabilityAutopilotTask.name);

  constructor(
    private readonly judgeStudyApplicability: JudgeStudyApplicabilityUsecase,
    private readonly config: ConfigService,
    @Inject(STUDY_BRIEF_REPOSITORY_PORT)
    private readonly studyBriefRepository: StudyBriefRepositoryPort,
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly previewRepository: PreviewActionRepositoryPort,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const collected: CollectedCards = { lines: [], previews: [] };

    // 카드를 낼 수 없는 설정이면 다시 집지 않는다 — 집어도 "카드 생략" 만 반복된다. 설정을 고친 뒤
    // 첫 회차부터 다시 집힌다.
    if (this.readValidRepo()) {
      for (const pending of await this.findAppliesWithoutCard(
        ownerSlackUserId,
      )) {
        this.collectCard(
          pending,
          ' (지난 회차에 카드가 만들어지지 않아 다시 올립니다)',
          collected,
        );
      }
    }

    // 창 안의 미판정 브리프를 한 회차에 전부 처리한다. 한 건씩만 집으면 한 번 밀린 브리프가 계속 앞에
    // 남아, 그날 브리프가 매번 다음 날에야 판정된다. 모델을 부르는 판정만 상한을 둔다 — 키워드·후보가
    // 없어 모델 없이 끝나는 판정은 비용이 없다.
    let modelJudgements = 0;
    for (
      let attempt = 0;
      attempt < MAX_BRIEFS_PER_RUN &&
      modelJudgements < MAX_MODEL_JUDGEMENTS_PER_RUN;
      attempt += 1
    ) {
      let result: StudyApplicabilityRunResult;
      try {
        result = await this.judgeStudyApplicability.execute({
          ownerSlackUserId,
          firedAtKst,
        });
      } catch (error: unknown) {
        // 판정을 한 건도 끝내지 못한 회차는 그대로 던져 orchestrator 가 실패로 알리게 한다(owner 멘션·
        // 실패 집계). 앞에서 다시 모은 누락 카드는 판정 진행이 아니므로 이 판단에 넣지 않는다 — 던지면
        // 그 카드는 이번 회차에 안 나가지만 카드 행이 없으니 다음 회차에 다시 잡혀 잃지 않는다.
        // 앞 판정이 끝난 뒤의 실패는 그 결과가 이미 저장됐으니 보고하고 멈춘다 — 실패한 브리프는
        // applicability 가 비어 다음 회차에 다시 잡힌다.
        if (attempt === 0) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`적용 판정 중단 — 다음 회차에 이어서: ${message}`);
        collected.lines.push(
          `_⚠️ 오늘의 공부 적용 판정 1건 실패 — 다음 회차에 다시 시도합니다: ${escapeSlackMrkdwn(message.slice(0, 200))}_`,
        );
        break;
      }
      if (result.status === 'empty') {
        break;
      }
      if (result.judgement.rawVerdict !== null) {
        modelJudgements += 1;
      }
      // 저장이 거부됐다면 다른 실행이 이 브리프를 이미 판정했다 — 카드는 그쪽 몫이다.
      if (
        result.judgement.verdict === APPLICABILITY_VERDICT.APPLY &&
        result.saved
      ) {
        this.collectCard(
          {
            id: result.briefId,
            topic: result.topic,
            notionUrl: result.notionUrl,
            judgement: result.judgement,
          },
          '',
          collected,
        );
      }
    }

    if (collected.lines.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: collected.lines.join('\n'),
      ...(collected.previews.length > 0
        ? { previews: collected.previews }
        : {}),
    };
  }

  private async findAppliesWithoutCard(
    ownerSlackUserId: string,
  ): Promise<JudgedApplyStudyBrief[]> {
    const since = new Date(Date.now() - PENDING_CARD_LOOKBACK_MS);
    const applied = await this.studyBriefRepository.findApplyJudgedSince(
      ownerSlackUserId,
      since,
    );
    // 브리프마다 카드 행이 있는지 정확히 센다(상태 무관). 기간·개수로 잘라 모아 오면 잘린 행이
    // "없음" 으로 읽혀 중복 발행이 된다. 창 안의 APPLY 는 하루 최대 1건이라 호출 수가 작다.
    const withoutCard: JudgedApplyStudyBrief[] = [];
    for (const brief of applied) {
      const cardCount = await this.previewRepository.countByPayloadValue({
        kind: PREVIEW_KIND.STUDY_APPLY_ISSUE,
        payloadPath: ['studyBriefId'],
        payloadValue: brief.id,
      });
      if (cardCount === 0) {
        withoutCard.push(brief);
      }
    }
    return withoutCard;
  }

  private readValidRepo(): string | undefined {
    const repo = this.config.get<string>('STUDY_APPLY_ISSUE_REPO')?.trim();
    return repo && GITHUB_REPO_PATTERN.test(repo) ? repo : undefined;
  }

  private collectCard(
    brief: JudgedApplyStudyBrief,
    note: string,
    collected: CollectedCards,
  ): void {
    const line = `🧭 *오늘의 공부 적용 판정* — ${escapeSlackMrkdwn(brief.topic)} · 적용 제안 1건${note}`;
    const repo = this.config.get<string>('STUDY_APPLY_ISSUE_REPO')?.trim();
    if (!repo) {
      collected.lines.push(
        `${line} (STUDY_APPLY_ISSUE_REPO 미설정 — 카드 생략, 설정하면 다음 회차에 카드가 나갑니다)`,
      );
      return;
    }
    if (!GITHUB_REPO_PATTERN.test(repo)) {
      collected.lines.push(
        `${line} (STUDY_APPLY_ISSUE_REPO 가 owner/repo 형식이 아님 — 카드 생략, 고치면 다음 회차에 카드가 나갑니다)`,
      );
      return;
    }
    const issue = buildStudyApplyIssue({
      topic: brief.topic,
      notionUrl: brief.notionUrl,
      judgement: brief.judgement,
    });
    const payload: StudyApplyIssuePayload = {
      studyBriefId: brief.id,
      repo,
      title: issue.title,
      body: issue.body,
    };
    collected.lines.push(line);
    collected.previews.push({
      kind: PREVIEW_KIND.STUDY_APPLY_ISSUE,
      payload,
      previewText: buildStudyApplyPreviewText({
        topic: brief.topic,
        judgement: brief.judgement,
        repo,
      }),
      ttlMs: STUDY_APPLY_PREVIEW_TTL_MS,
    });
  }
}
