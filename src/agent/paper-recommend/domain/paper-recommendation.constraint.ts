import {
  ConstrainedPaperRecommendation,
  ConstrainPaperRecommendationInput,
  PaperRecommendationCandidate,
  PaperRecommendationSkip,
} from './paper-recommendation.type';

// 프롬프트가 같은 값을 따로 적어 두면 한쪽만 바뀌어 모델이 실제와 다른 규칙을 안내받는다.
// 프롬프트가 이 상수를 읽어 쓰도록 내보낸다.
export const MAXIMUM_BUY_COUNT = 3;
export const MAXIMUM_WEIGHT_PERCENT = 20;

export const constrainPaperRecommendation = (
  input: ConstrainPaperRecommendationInput,
): ConstrainedPaperRecommendation => {
  const positionsByCode = new Map(
    input.positions.map((position) => [position.code, position]),
  );
  const candidatesByCode = new Map(
    input.candidates.map((candidate) => [candidate.code, candidate]),
  );
  const skipped: PaperRecommendationSkip[] = [];

  return {
    sells: uniqueByCode(input.recommendation.sells).flatMap((sell) => {
      const position = positionsByCode.get(sell.code);
      if (!position || position.quantity <= 0) {
        skipped.push({ side: 'SELL', code: sell.code, reason: 'NOT_HELD' });
        return [];
      }
      return [
        {
          side: 'SELL' as const,
          tickerId: position.tickerId,
          code: position.code,
          reason: sell.reason,
          quantity: position.quantity,
        },
      ];
    }),
    buys: constrainBuys(input, candidatesByCode, positionsByCode, skipped),
    skipped,
  };
};

const constrainBuys = (
  input: ConstrainPaperRecommendationInput,
  candidatesByCode: Map<string, PaperRecommendationCandidate>,
  positionsByCode: Map<
    string,
    { tickerId: number; code: string; quantity: number }
  >,
  skipped: PaperRecommendationSkip[],
): ConstrainedPaperRecommendation['buys'] => {
  let remainingCash = Math.max(0, input.cashBalance);
  const accountValuation = Math.max(0, input.accountValuation);
  const selectedCodes = new Set<string>();
  const constrainedBuys: ConstrainedPaperRecommendation['buys'] = [];
  // 비중은 언어모델이 아니라 코드가 정한다. 모델이 숫자를 뱉던 시절에는 같은 후보에도 회차마다
  // 다른 수량이 나와 (1) 백테스트 재생이 원래 결과를 복원하지 못했고 (2) 규칙을 바꿨을 때 성적
  // 변화가 규칙 때문인지 모델이 그날 다르게 답해서인지 가를 수 없었다.
  // 종목당 상한을 그대로 비중으로 쓴다 — 최대 3종 x 20% = 60% 까지 투입되고 나머지는 현금이다.
  const weightPercent = resolveWeightPercent(input.maximumWeightPercent);

  for (const buy of input.recommendation.buys) {
    if (constrainedBuys.length >= MAXIMUM_BUY_COUNT) {
      skipped.push({
        side: 'BUY',
        code: buy.code,
        reason: 'BUY_LIMIT_REACHED',
      });
      continue;
    }
    if (selectedCodes.has(buy.code) || positionsByCode.has(buy.code)) {
      skipped.push({
        side: 'BUY',
        code: buy.code,
        reason: 'ALREADY_HELD',
      });
      continue;
    }
    selectedCodes.add(buy.code);
    const candidate = candidatesByCode.get(buy.code);
    if (
      !candidate ||
      candidate.close <= 0 ||
      !Number.isFinite(candidate.close)
    ) {
      skipped.push({
        side: 'BUY',
        code: buy.code,
        reason: 'NOT_IN_CANDIDATES',
      });
      continue;
    }
    if (weightPercent <= 0) {
      skipped.push({ side: 'BUY', code: buy.code, reason: 'ZERO_WEIGHT' });
      continue;
    }
    const targetAmount = (accountValuation * weightPercent) / 100;
    const desiredQuantity = Math.floor(targetAmount / candidate.close);
    const affordableQuantity = Math.floor(remainingCash / candidate.close);
    const quantity = Math.min(desiredQuantity, affordableQuantity);
    if (quantity <= 0) {
      skipped.push({
        side: 'BUY',
        code: buy.code,
        reason: 'INSUFFICIENT_CASH',
      });
      continue;
    }
    remainingCash -= quantity * candidate.close;
    constrainedBuys.push({
      side: 'BUY',
      tickerId: candidate.tickerId,
      code: candidate.code,
      name: candidate.name,
      reason: buy.reason,
      weightPercent,
      quantity,
      close: candidate.close,
    });
  }

  return constrainedBuys;
};

const uniqueByCode = <T extends { code: string }>(values: T[]): T[] => {
  const codes = new Set<string>();
  return values.filter((value) => {
    if (codes.has(value.code)) {
      return false;
    }
    codes.add(value.code);
    return true;
  });
};

// 상한이 곧 비중이라 이 값이 매수 수량의 유일한 결정 입력이다. 숫자가 아닌 값이 들어오면
// targetAmount 가 NaN 이 되고 `quantity <= 0` 검사를 그대로 통과해 NaN 주문이 만들어지므로
// 여기서 0 으로 떨어뜨려 ZERO_WEIGHT 로 기록되게 한다.
const resolveWeightPercent = (maximumWeightPercent?: number): number => {
  if (maximumWeightPercent === undefined) {
    return MAXIMUM_WEIGHT_PERCENT;
  }
  if (!Number.isFinite(maximumWeightPercent)) {
    return 0;
  }
  return Math.max(0, maximumWeightPercent);
};
