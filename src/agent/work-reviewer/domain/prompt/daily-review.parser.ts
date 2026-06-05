import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
import { WorkReviewerException } from '../work-reviewer.exception';
import { DailyReview } from '../work-reviewer.type';
import { WorkReviewerErrorCode } from '../work-reviewer-error-code.enum';
import { isDailyReviewShape } from './daily-review.shape';

// LLM 응답 텍스트를 DailyReview 구조로 파싱. extractJsonObjectText 가 code fence (전체/부분) +
// fence 없는 mixed content 3가지 noise 패턴을 모두 흡수.
export const parseDailyReview = (text: string): DailyReview => {
  const cleaned = extractJsonObjectText(text);

  const parsed = parseJson(cleaned, text);

  if (!isDailyReviewShape(parsed)) {
    throw new WorkReviewerException({
      code: WorkReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 DailyReview 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  return parsed;
};

const parseJson = (text: string, rawText: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new WorkReviewerException({
      code: WorkReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: new Error(buildJsonParseCauseMessage(error, rawText)),
    });
  }
};
