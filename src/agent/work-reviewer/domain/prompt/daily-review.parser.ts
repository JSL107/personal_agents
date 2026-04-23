import { HttpStatus } from '@nestjs/common';

import { WorkReviewerException } from '../work-reviewer.exception';
import { DailyReview } from '../work-reviewer.type';
import { WorkReviewerErrorCode } from '../work-reviewer-error-code.enum';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

// LLM 응답 텍스트를 DailyReview 구조로 파싱한다.
// 프롬프트는 순수 JSON 을 요구하지만 모델이 ```json``` 블록으로 감싸는 경우가 빈번해 코드 펜스를 선제 제거한다.
export const parseDailyReview = (text: string): DailyReview => {
  const cleaned = stripCodeFence(text.trim());

  const parsed = parseJson(cleaned);

  if (!isDailyReviewShape(parsed)) {
    throw new WorkReviewerException({
      code: WorkReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 DailyReview 스키마와 맞지 않습니다.',
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
    throw new WorkReviewerException({
      code: WorkReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: HttpStatus.BAD_GATEWAY,
      cause: error,
    });
  }
};

const isDailyReviewShape = (value: unknown): value is DailyReview => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === 'string' &&
    isImpactShape(record.impact) &&
    isImprovementShape(record.improvementBeforeAfter) &&
    isStringArray(record.nextActions) &&
    typeof record.oneLineAchievement === 'string'
  );
};

const isImpactShape = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isStringArray(record.quantitative) && typeof record.qualitative === 'string'
  );
};

const isImprovementShape = (value: unknown): boolean => {
  if (value === null) {
    return true;
  }
  if (typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.before === 'string' && typeof record.after === 'string';
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
