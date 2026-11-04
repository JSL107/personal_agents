import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  UNTRUSTED_INPUT_NOTICE,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { formatKstDateTime } from '../../common/util/kst-date.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  OutputJsonSchema,
} from '../../model-router/domain/model-router.type';
import { DispatchOutcome } from '../../router/domain/port/agent-dispatcher.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { formatManagementReply } from '../../slack/format/schedule-management.formatter';
import { findByTitle } from '../domain/find-by-title';
import {
  matchesManagementAction,
  parseManagementIntent,
} from '../domain/management-intent';
import {
  ManagementAction,
  ManagementIntent,
  ManagementWriteInput,
  ManagementWriteResult,
  ManageScheduleInput,
} from '../domain/management-intent.type';
import { FollowUpTrigger } from '../domain/schedule.type';
import { ScheduleFollowUpUsecase } from './schedule-follow-up.usecase';
import { UpdateScheduleFieldsUsecase } from './update-schedule-fields.usecase';
import { UpdateScheduleStatusUsecase } from './update-schedule-status.usecase';

const OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: Object.values(ManagementAction) },
    titleQuery: { type: 'string' },
    status: { type: 'string' },
    remindAt: { type: 'string' },
    recipient: { type: 'string' },
    topic: { type: 'string' },
    trigger: { type: 'string', enum: Object.values(FollowUpTrigger) },
    triggerAt: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['action', 'titleQuery'],
  additionalProperties: false,
};

@Injectable()
export class ManageScheduleFromConversationUsecase {
  private readonly logger = new Logger(
    ManageScheduleFromConversationUsecase.name,
  );

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly updateStatus: UpdateScheduleStatusUsecase,
    private readonly updateFields: UpdateScheduleFieldsUsecase,
    private readonly followUp: ScheduleFollowUpUsecase,
  ) {}

  async execute({
    input,
    candidates,
  }: ManageScheduleInput): Promise<DispatchOutcome> {
    let intent: ManagementIntent;
    let modelUsed: string;
    try {
      const extraction = await this.agentRunService.execute<ManagementIntent>({
        agentType: AgentType.SCHEDULE,
        triggerType: TriggerType.SLACK_MENTION_SCHEDULE,
        inputSnapshot: {
          slackUserId: input.slackUserId,
          action: 'EXTRACT_MANAGEMENT',
          text: input.text,
        },
        run: async () => {
          const completion = await this.modelRouter.route({
            agentType: AgentType.SCHEDULE,
            request: {
              prompt: `현재 시각 (Asia/Seoul): ${formatKstDateTime(new Date())}\n미완 업무 제목:\n${wrapUntrustedInput(JSON.stringify(candidates.map((candidate) => candidate.title)))}\n사용자 요청:\n${wrapUntrustedInput(input.text ?? '')}`,
              systemPrompt: `업무 관리 동작과 대상 제목을 JSON으로 추출하세요. titleQuery는 미완 업무 제목 목록에서 정확히 복사하세요. 사용하지 않는 필드는 생략하세요. 상대 날짜·시각은 Asia/Seoul 기준으로 해석하고, 결과는 UTC offset을 포함한 ISO 8601로 쓰세요. ${UNTRUSTED_INPUT_NOTICE}`,
              outputSchema: OUTPUT_SCHEMA,
            },
            noContractPreamble: true,
          });
          const parsed = parseManagementIntent(
            JSON.parse(completion.text) as unknown,
          );
          if (!parsed) {
            throw new Error('업무 관리 모델 출력이 올바르지 않습니다.');
          }
          return {
            result: parsed,
            modelUsed: completion.modelUsed,
            output: { action: parsed.action, titleQuery: parsed.titleQuery },
          };
        },
      });
      intent = extraction.result;
      modelUsed = extraction.modelUsed;
    } catch (error) {
      this.logger.warn(
        `업무 관리 해석 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.reply(
        '업무 관리 요청을 이해하지 못했어요. 예: 결제 API 내일 3시에 알려줘',
      );
    }
    const text = input.text ?? '';
    if (
      !matchesManagementAction({ text, intent }) ||
      !text.toLocaleLowerCase().includes(intent.titleQuery.toLocaleLowerCase())
    ) {
      return this.reply(
        '업무 관리 요청을 이해하지 못했어요. 예: 결제 API 내일 3시에 알려줘',
      );
    }
    const match = findByTitle({ items: candidates, query: intent.titleQuery });
    if (match.kind === 'NONE') {
      return this.reply('어떤 업무인지 알려 주세요.');
    }
    if (match.kind === 'MANY') {
      return this.reply(
        `어떤 업무인지 알려 주세요.\n${match.items.map((item) => `• ${escapeSlackMrkdwn(item.title)}`).join('\n')}`,
      );
    }
    const item = match.item;
    const outcome = await this.agentRunService.execute<ManagementWriteResult>({
      agentType: AgentType.SCHEDULE,
      triggerType: TriggerType.SLACK_MENTION_SCHEDULE,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        scheduleId: item.id,
        action: intent.action,
      },
      run: async () => {
        try {
          await this.write({ item, intent, slackUserId: input.slackUserId });
          return {
            result: { applied: true },
            modelUsed,
            output: {
              scheduleId: item.id,
              title: item.title,
              action: intent.action,
            },
          };
        } catch (error) {
          if (
            error instanceof BadRequestException ||
            error instanceof ConflictException ||
            error instanceof NotFoundException
          ) {
            return {
              result: { applied: false, reason: error.message },
              modelUsed,
              output: {
                scheduleId: item.id,
                title: item.title,
                action: intent.action,
                reason: error.message,
              },
            };
          }
          throw error;
        }
      },
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: outcome.result.applied
        ? formatManagementReply({ title: item.title, intent })
        : escapeSlackMrkdwn(outcome.result.reason ?? ''),
    };
  }

  private async write({
    item,
    intent,
    slackUserId,
  }: ManagementWriteInput): Promise<void> {
    switch (intent.action) {
      case ManagementAction.STATUS:
        await this.updateStatus.execute({
          id: item.id,
          slackUserId,
          status: intent.status!,
        });
        return;
      case ManagementAction.REMIND:
        await this.updateFields.execute({
          id: item.id,
          slackUserId,
          patch: { remindAt: intent.remindAt! },
        });
        return;
      case ManagementAction.FOLLOW_UP:
        await this.followUp.add({
          scheduleItemId: item.id,
          slackUserId,
          recipient: intent.recipient!,
          topic: intent.topic!,
          trigger: intent.trigger!,
          ...(intent.triggerAt && { triggerAt: intent.triggerAt }),
        });
        return;
      case ManagementAction.NOTE:
        await this.followUp.note({
          scheduleItemId: item.id,
          slackUserId,
          text: intent.note!,
          now: new Date(),
        });
        return;
    }
  }

  private reply(formattedText: string): DispatchOutcome {
    return {
      agentRunId: 0,
      output: {},
      modelUsed: 'deterministic',
      formattedText,
    };
  }
}
