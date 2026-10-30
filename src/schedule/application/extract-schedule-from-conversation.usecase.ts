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

const SYSTEM_PROMPT = `대화에서 등록할 일정 제목, 날짜와 원인을 포함한 메모를 추출하세요. 날짜가 없으면 null입니다.\n${UNTRUSTED_INPUT_NOTICE}`;
const TITLE_MAX_LENGTH = 60;
const MEMO_MAX_LENGTH = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class ExtractScheduleFromConversationUsecase {
  private readonly logger = new Logger(
    ExtractScheduleFromConversationUsecase.name,
  );

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async execute({
    text,
    priorTurns,
    today,
  }: ExtractScheduleInput): Promise<ExtractedSchedule | null> {
    const conversation = priorTurns.map(renderTurn).join('\n');
    const prompt = `기준일: ${JSON.stringify(today)}\n직전 대화:\n${conversation}\n현재 요청: ${text}`;
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.SCHEDULE,
        request: {
          prompt,
          systemPrompt: SYSTEM_PROMPT,
          outputSchema: OUTPUT_SCHEMA,
        },
        noContractPreamble: true,
      });
      const candidate = parseObject(completion.text);
      // outputSchema 로 형태를 강제하지만 산문 약속을 믿지 않고 코드가 다시 검증한다.
      const title = readTitle(candidate?.title);
      const memo = readMemo(candidate?.memo);
      const dueDate = readDueDate({ value: candidate?.dueDate, today });
      if (title === null || memo === null || !dueDate.valid) {
        return null;
      }
      const extracted: ExtractedSchedule = {
        title,
        dueDate: dueDate.value,
        memo,
        modelUsed: completion.modelUsed,
      };
      return extracted;
    } catch (error) {
      this.logger.warn(
        `대화 일정 추출 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}

type DueDateReading =
  | { valid: true; value: PlainDate | null }
  | { valid: false };

// 자동 발송 글은 대화 상대의 지시가 아니라 참고 자료다. 이미 표식과 경계로 감싸져 있어 그대로 싣는다.
const renderTurn = (turn: ConversationTurn): string => {
  if (isAutoPostTurn(turn)) {
    return turn.text;
  }
  const speaker = turn.role === 'assistant' ? '이대리' : '사용자';
  return `${speaker}: ${turn.text}`;
};

const parseObject = (text: string): Record<string, unknown> | null => {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
};

const readTitle = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const title = value.trim();
  if (title.length < 1 || title.length > TITLE_MAX_LENGTH) {
    return null;
  }
  return title;
};

const readMemo = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const memo = value.slice(0, MEMO_MAX_LENGTH);
  return memo;
};

// null 은 "날짜 없음"(유효), 형식이 틀리거나 없는 날짜(2026-02-30)는 무효다.
const readDueDate = ({
  value,
  today,
}: {
  value: unknown;
  today: PlainDate;
}): DueDateReading => {
  if (value === null) {
    return { valid: true, value: null };
  }
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return { valid: false };
  }
  const parsed = parseDueDate(value, today);
  if (!parsed) {
    return { valid: false };
  }
  return { valid: true, value: parsed };
};
