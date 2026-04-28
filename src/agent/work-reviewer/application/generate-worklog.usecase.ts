import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { AppendWorklogUsecase } from '../../../notion/application/append-worklog.usecase';
import { parseDailyReview } from '../domain/prompt/daily-review.parser';
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

    return this.agentRunService.execute({
      agentType: AgentType.WORK_REVIEWER,
      triggerType: triggerType ?? TriggerType.SLACK_COMMAND_WORKLOG,
      inputSnapshot: { workText: trimmed, slackUserId },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_WORKLOG',
          sourceId: slackUserId,
          payload: { workText: trimmed },
        },
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.WORK_REVIEWER,
          request: {
            prompt: trimmed,
            systemPrompt: WORK_REVIEWER_SYSTEM_PROMPT,
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
