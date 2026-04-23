import { HttpStatus } from '@nestjs/common';

import { PmAgentException } from '../pm-agent.exception';
import { DailyPlan } from '../pm-agent.type';
import { PmAgentErrorCode } from '../pm-agent-error-code.enum';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

// LLM 응답 텍스트를 DailyPlan 구조로 파싱한다.
// 프롬프트는 순수 JSON 을 요구하지만 모델이 ```json``` 블록으로 감싸는 경우가 빈번해 코드 펜스를 선제 제거한다.
export const parseDailyPlan = (text: string): DailyPlan => {
  const cleaned = stripCodeFence(text.trim());

  const parsed = parseJson(cleaned);

  if (!isDailyPlanShape(parsed)) {
    throw new PmAgentException({
      code: PmAgentErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 DailyPlan 스키마와 맞지 않습니다.',
      status: HttpStatus.BAD_GATEWAY,
    });
  }

  return parsed;
};

const stripCodeFence = (text: string): string => {
  const match = text.match(CODE_FENCE_PATTERN);
  if (!match) {
    return text;
  }
  return match[1].trim();
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new PmAgentException({
      code: PmAgentErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: HttpStatus.BAD_GATEWAY,
      cause: error,
    });
  }
};

const isDailyPlanShape = (value: unknown): value is DailyPlan => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.topPriority === 'string' &&
    isStringArray(record.morning) &&
    isStringArray(record.afternoon) &&
    (record.blocker === null || typeof record.blocker === 'string') &&
    typeof record.estimatedHours === 'number' &&
    typeof record.reasoning === 'string'
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
