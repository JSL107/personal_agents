import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import {
  EvidenceInput,
  TriggerType,
} from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { UNTRUSTED_INPUT_NOTICE } from '../../../common/llm/untrusted-input.util';
import {
  kstStartOfDay,
  WorkSessionDigestService,
} from '../../../local-sessions/application/work-session-digest.service';
import {
  formatWorkSessionsSection,
  toWorkSessionEvidencePayload,
  WorkSessionDigest,
} from '../../../local-sessions/domain/work-session-digest';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { AppendWorklogUsecase } from '../../../notion/application/append-worklog.usecase';
import { parseDailyReview } from '../domain/prompt/daily-review.parser';
import { DAILY_REVIEW_OUTPUT_SCHEMA } from '../domain/prompt/daily-review.schema';
import { WORK_REVIEWER_SYSTEM_PROMPT } from '../domain/prompt/work-reviewer-system.prompt';
import { WorkReviewerException } from '../domain/work-reviewer.exception';
import {
  DailyReview,
  GenerateWorklogInput,
} from '../domain/work-reviewer.type';
import { WorkReviewerErrorCode } from '../domain/work-reviewer-error-code.enum';

const KST_OFFSET_HOURS = 9;

// KST 기준 "오늘" 을 UTC 00:00 Date 로 반환 (PM 과 동일 정규화).
// reviewDate 를 request 진입 시점에 고정해 midnight 근처 race 방지 (codex review b1309omm0 P1 와 동일 패턴).
const getKstTodayAsUtcDate = (): Date => {
  const nowMs = Date.now();
  const kstMs = nowMs + KST_OFFSET_HOURS * 60 * 60 * 1000;
  const kstDate = new Date(kstMs);
  return new Date(
    Date.UTC(
      kstDate.getUTCFullYear(),
      kstDate.getUTCMonth(),
      kstDate.getUTCDate(),
    ),
  );
};

@Injectable()
export class GenerateWorklogUsecase {
  private readonly logger = new Logger(GenerateWorklogUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly appendWorklogUsecase: AppendWorklogUsecase,
    private readonly workSessionDigestService: WorkSessionDigestService,
  ) {}

  async execute({
    workText,
    slackUserId,
    triggerType,
  }: GenerateWorklogInput): Promise<AgentRunOutcome<DailyReview>> {
    const trimmed = workText.trim();
    if (trimmed.length === 0) {
      throw new WorkReviewerException({
        code: WorkReviewerErrorCode.EMPTY_WORK_INPUT,
        message:
          '오늘 한 일이 비어 있습니다. `/worklog <오늘 한 일>` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const reviewDate = getKstTodayAsUtcDate();
    const since = kstStartOfDay(new Date());
    let sessions: WorkSessionDigest[] = [];
    if (triggerType !== TriggerType.WEEKLY_SUMMARY_CRON) {
      try {
        sessions = this.workSessionDigestService.listSince({
          since,
          slackUserId,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `작업 세션 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const section = formatWorkSessionsSection({
      sessions,
      header:
        '[로컬 작업 세션 — 오늘 Claude Code·Codex 대화형 세션 요약 (실적 판단 참고, 계획과 같은 등급의 근거 아님)]',
    });
    const evidence: EvidenceInput[] = [
      {
        sourceType: 'SLACK_COMMAND_WORKLOG',
        sourceId: slackUserId,
        payload: { workText: trimmed },
      },
    ];
    if (section) {
      evidence.push({
        sourceType: 'LOCAL_WORK_SESSIONS',
        sourceId: 'local',
        payload: toWorkSessionEvidencePayload(sessions, since),
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.WORK_REVIEWER,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_WORKLOG,
      inputSnapshot: { workText: trimmed, slackUserId },
      evidence,
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.WORK_REVIEWER,
          request: {
            prompt: section ? `${trimmed}\n\n${section}` : trimmed,
            systemPrompt: section
              ? `${WORK_REVIEWER_SYSTEM_PROMPT}\n\n${UNTRUSTED_INPUT_NOTICE}`
              : WORK_REVIEWER_SYSTEM_PROMPT,
            outputSchema: DAILY_REVIEW_OUTPUT_SCHEMA,
          },
        });
        const review = parseDailyReview(completion.text);

        // Notion day-page 에 Check Out + KPT 섹션 append — graceful fire-and-forget.
        // 실패해도 review 응답은 사용자에게 정상 반환.
        try {
          await this.appendWorklogUsecase.execute({ review, reviewDate });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Notion worklog 기록 실패 (review 응답은 정상 반환): ${message}`,
          );
        }

        return {
          result: review,
          modelUsed: completion.modelUsed,
          output: review,
        };
      },
    });
  }
}
