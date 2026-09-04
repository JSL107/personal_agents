import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
import { WorkReviewerException } from '../work-reviewer.exception';
import { DailyReview } from '../work-reviewer.type';
import { WorkReviewerErrorCode } from '../work-reviewer-error-code.enum';
import {
  fillMissingBriefingFields,
  isDailyReviewShape,
} from './daily-review.shape';

// LLM 응답 텍스트를 DailyReview 구조로 파싱. extractJsonObjectText 가 code fence (전체/부분) +
// fence 없는 mixed content 3가지 noise 패턴을 모두 흡수.
export const parseDailyReview = (text: string): DailyReview => {
  const cleaned = extractJsonObjectText(text);

  // decisions / risks 는 codex 경로에서만 output schema 로 강제된다. claude CLI · mock provider
  // 는 스키마를 안 받으므로, 두 키가 빠졌다고 회고 전체를 실패시키지 않고 빈 배열로 채운다.
  const parsed = fillMissingBriefingFields(parseJson(cleaned, text));

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
