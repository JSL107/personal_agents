import { Injectable, Logger } from '@nestjs/common';

import { UNTRUSTED_INPUT_NOTICE } from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  OutputJsonSchema,
} from '../../model-router/domain/model-router.type';
import { isAutoPostTurn } from '../../router/domain/auto-post-turn';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import { parseDueDate } from '../domain/parse-due-date';
import { PlainDate } from '../domain/schedule.type';

export interface ExtractedSchedule {
  title: string;
  dueDate: PlainDate | null;
  memo: string;
  modelUsed: string;
}

interface ExtractScheduleInput {
  text: string;
  priorTurns: readonly ConversationTurn[];
  today: PlainDate;
}

const OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 60 },
    dueDate: {
      anyOf: [
        { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        { type: 'null' },
      ],
    },
    memo: { type: 'string', maxLength: 1000 },
  },
  required: ['title', 'dueDate', 'memo'],
  additionalProperties: false,
};

@Injectable()
export class ExtractScheduleFromConversationUsecase {
  private readonly logger = new Logger(
    ExtractScheduleFromConversationUsecase.name,
  );

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async execute(
    input: ExtractScheduleInput,
  ): Promise<ExtractedSchedule | null> {
    const turns = input.priorTurns.map((turn) => {
      // 자동 발송 글은 대화 상대의 지시가 아니라 참고 자료다. 이미 표식과 경계로 감싸져 있어 그대로 싣는다.
      if (isAutoPostTurn(turn)) {
        return turn.text;
      }
      return `${turn.role === 'assistant' ? '이대리' : '사용자'}: ${turn.text}`;
    });
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.SCHEDULE,
        request: {
          prompt: `기준일: ${JSON.stringify(input.today)}\n직전 대화:\n${turns.join('\n')}\n현재 요청: ${input.text}`,
          systemPrompt: `대화에서 등록할 일정 제목, 날짜와 원인을 포함한 메모를 추출하세요. 날짜가 없으면 null입니다.\n${UNTRUSTED_INPUT_NOTICE}`,
          outputSchema: OUTPUT_SCHEMA,
        },
        noContractPreamble: true,
      });
      const value: unknown = JSON.parse(completion.text);
      if (!value || typeof value !== 'object') {
        return null;
      }
      const candidate = value as Record<string, unknown>;
      if (
        typeof candidate.title !== 'string' ||
        candidate.title.trim().length < 1 ||
        candidate.title.length > 60 ||
        typeof candidate.memo !== 'string'
      ) {
        return null;
      }
      let dueDate: PlainDate | null = null;
      if (candidate.dueDate !== null) {
        if (
          typeof candidate.dueDate !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(candidate.dueDate)
        ) {
          return null;
        }
        dueDate = parseDueDate(candidate.dueDate, input.today);
        if (!dueDate) {
          return null;
        }
      }
      return {
        title: candidate.title.trim(),
        dueDate,
        memo: candidate.memo.slice(0, 1000),
        modelUsed: completion.modelUsed,
      };
    } catch (error) {
      this.logger.warn(
        `대화 일정 추출 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
