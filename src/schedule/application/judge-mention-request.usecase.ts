import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  UNTRUSTED_INPUT_NOTICE,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { SlackMention } from '../../slack-collector/domain/slack-collector.type';
import { MentionRequestJudgment } from '../domain/mention-request.type';
import { parseDueDate, todayInKst } from '../domain/parse-due-date';
import { MENTION_REQUEST_OUTPUT_SCHEMA } from '../domain/prompt/mention-request.schema';
import { PlainDate } from '../domain/schedule.type';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SYSTEM_PROMPT = `나를 멘션한 메시지가 나에게 무언가 해 달라는 요청인지 판정하세요. JSON의 isRequest, title, dueDate를 모두 채우세요. 요청이 아니면 dueDate는 null입니다. 날짜가 없으면 null, 있으면 YYYY-MM-DD입니다. title은 간결한 업무 제목입니다. ${UNTRUSTED_INPUT_NOTICE}`;
const SLACK_TIMESTAMP = /^\d+(?:\.\d+)?$/;

const mentionDateInKst = (timestamp: string): PlainDate => {
  const seconds = Number(timestamp);
  const date = new Date(seconds * 1000);
  return todayInKst(
    SLACK_TIMESTAMP.test(timestamp) &&
      Number.isFinite(seconds) &&
      !Number.isNaN(date.getTime())
      ? date
      : new Date(),
  );
};

@Injectable()
export class JudgeMentionRequestUsecase {
  private readonly logger = new Logger(JudgeMentionRequestUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute(mention: SlackMention): Promise<MentionRequestJudgment | null> {
    try {
      const outcome =
        await this.agentRunService.execute<MentionRequestJudgment>({
          agentType: AgentType.SCHEDULE,
          triggerType: TriggerType.AUTOPILOT_SCHEDULE_COLLECT_CRON,
          inputSnapshot: {
            channelId: mention.channelId,
            ts: mention.ts,
            action: 'JUDGE_MENTION',
          },
          run: async () => {
            const completion = await this.modelRouter.route({
              agentType: AgentType.SCHEDULE,
              request: {
                prompt: `메시지 작성일(KST): ${JSON.stringify(mentionDateInKst(mention.ts))}\n상대 날짜는 메시지 작성일을 기준으로 해석하세요.\n메시지:\n${wrapUntrustedInput(mention.text)}`,
                systemPrompt: SYSTEM_PROMPT,
                outputSchema: MENTION_REQUEST_OUTPUT_SCHEMA,
              },
              noContractPreamble: true,
            });
            const judgment = parseJudgment(completion.text);
            if (!judgment) {
              throw new Error('멘션 판정 모델 출력이 올바르지 않습니다.');
            }
            return {
              result: judgment,
              modelUsed: completion.modelUsed,
              output: judgment,
            };
          },
        });
      return outcome.result;
    } catch (error) {
      this.logger.warn(
        `멘션 판정 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

const parseJudgment = (text: string): MentionRequestJudgment | null => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== 3 ||
    !['isRequest', 'title', 'dueDate'].every((key) =>
      Object.prototype.hasOwnProperty.call(candidate, key),
    )
  ) {
    return null;
  }
  if (
    typeof candidate.isRequest !== 'boolean' ||
    typeof candidate.title !== 'string'
  ) {
    return null;
  }
  const title = candidate.title.trim();
  if (candidate.isRequest && (title.length === 0 || title.length > 200)) {
    return null;
  }
  if (candidate.dueDate === null) {
    return { isRequest: candidate.isRequest, title, dueDate: null };
  }
  if (
    typeof candidate.dueDate !== 'string' ||
    !ISO_DATE.test(candidate.dueDate)
  ) {
    return null;
  }
  const dueDate = parseDueDate(candidate.dueDate, todayInKst(new Date()));
  return dueDate ? { isRequest: candidate.isRequest, title, dueDate } : null;
};
