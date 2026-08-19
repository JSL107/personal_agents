import { PaperRecommendationException } from './paper-recommendation.exception';
import {
  PaperRecommendation,
  PaperRecommendationBuy,
  PaperRecommendationSell,
} from './paper-recommendation.type';
import { PaperRecommendationErrorCode } from './paper-recommendation-error-code.enum';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu;

export const parsePaperRecommendation = (raw: string): PaperRecommendation => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw.trim()));
  } catch (error: unknown) {
    throw invalidModelOutput(
      '모델 응답을 JSON으로 파싱하지 못했습니다.',
      error,
    );
  }

  if (!isRecord(parsed)) {
    throw invalidModelOutput('모델 응답이 객체가 아닙니다.');
  }

  return {
    sells: parseSells(parsed.sells),
    buys: parseBuys(parsed.buys),
  };
};

const stripCodeFence = (value: string): string => {
  const match = value.match(CODE_FENCE_PATTERN);
  return match ? match[1].trim() : value;
};

const parseSells = (value: unknown): PaperRecommendationSell[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidModelOutput('sells 필드가 배열이 아닙니다.');
  }
  if (!value.every(isSell)) {
    throw invalidModelOutput('sells 항목이 스키마와 맞지 않습니다.');
  }
  return value;
};

const parseBuys = (value: unknown): PaperRecommendationBuy[] => {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidModelOutput('buys 필드가 배열이 아닙니다.');
  }
  if (!value.every(isBuy)) {
    throw invalidModelOutput('buys 항목이 스키마와 맞지 않습니다.');
  }
  // 원본을 그대로 돌려주면 모델이 덧붙인 weightPercent 가 런타임 객체에 남는다. 지금은 아무도
  // 읽지 않지만 남겨 두면 나중에 누가 읽어 비결정성이 되살아나므로 여기서 떨궈 낸다.
  return value.map((buy) => ({ code: buy.code, reason: buy.reason }));
};

const isSell = (value: unknown): value is PaperRecommendationSell =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  typeof value.reason === 'string';

// 모델이 weightPercent 를 덧붙여 보내도 오류로 보지 않는다 — 비중은 코드가 정하므로 읽지 않고,
// parseBuys 가 code·reason 만 남겨 반환한다.
const isBuy = (value: unknown): value is PaperRecommendationBuy =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  typeof value.reason === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidModelOutput = (
  message: string,
  cause?: unknown,
): PaperRecommendationException =>
  new PaperRecommendationException({
    message,
    code: PaperRecommendationErrorCode.INVALID_MODEL_OUTPUT,
    cause,
  });
