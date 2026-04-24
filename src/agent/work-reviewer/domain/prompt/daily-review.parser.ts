import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { WorkReviewerException } from '../work-reviewer.exception';
import { DailyReview } from '../work-reviewer.type';
import { WorkReviewerErrorCode } from '../work-reviewer-error-code.enum';
import { isDailyReviewShape } from './daily-review.shape';

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
      status: DomainStatus.BAD_GATEWAY,
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
      status: DomainStatus.BAD_GATEWAY,
      cause: error,
    });
  }
};
