import {
  ConstrainedPaperRecommendation,
  ConstrainPaperRecommendationInput,
  PaperRecommendationCandidate,
} from './paper-recommendation.type';

const MAXIMUM_BUY_COUNT = 3;
const MAXIMUM_WEIGHT_PERCENT = 20;

export const constrainPaperRecommendation = (
  input: ConstrainPaperRecommendationInput,
): ConstrainedPaperRecommendation => {
  const positionsByCode = new Map(
    input.positions.map((position) => [position.code, position]),
  );
  const candidatesByCode = new Map(
    input.candidates.map((candidate) => [candidate.code, candidate]),
  );

  return {
    sells: uniqueByCode(input.recommendation.sells).flatMap((sell) => {
      const position = positionsByCode.get(sell.code);
      if (!position || position.quantity <= 0) {
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
    buys: constrainBuys(input, candidatesByCode, positionsByCode),
  };
};

const constrainBuys = (
  input: ConstrainPaperRecommendationInput,
  candidatesByCode: Map<string, PaperRecommendationCandidate>,
  positionsByCode: Map<
    string,
    { tickerId: number; code: string; quantity: number }
  >,
): ConstrainedPaperRecommendation['buys'] => {
  let remainingCash = Math.max(0, input.cashBalance);
  const accountValuation = Math.max(0, input.accountValuation);
  const selectedCodes = new Set<string>();
  const constrainedBuys: ConstrainedPaperRecommendation['buys'] = [];

  for (const buy of input.recommendation.buys) {
    if (constrainedBuys.length >= MAXIMUM_BUY_COUNT) {
      break;
    }
    if (selectedCodes.has(buy.code) || positionsByCode.has(buy.code)) {
      continue;
    }
    selectedCodes.add(buy.code);
    const candidate = candidatesByCode.get(buy.code);
    if (
      !candidate ||
      candidate.close <= 0 ||
      !Number.isFinite(candidate.close)
    ) {
      continue;
    }
    const weightPercent = clampWeightPercent(buy.weightPercent);
    if (weightPercent <= 0) {
      continue;
    }
    const targetAmount = (accountValuation * weightPercent) / 100;
    const desiredQuantity = Math.floor(targetAmount / candidate.close);
    const affordableQuantity = Math.floor(remainingCash / candidate.close);
    const quantity = Math.min(desiredQuantity, affordableQuantity);
    if (quantity <= 0) {
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

const clampWeightPercent = (value: number): number =>
  Math.min(MAXIMUM_WEIGHT_PERCENT, Math.max(0, value));

export const nextWeekday = (currentDate: Date): Date => {
  const nextDate = new Date(
    Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate() + 1,
    ),
  );
  while (nextDate.getUTCDay() === 0 || nextDate.getUTCDay() === 6) {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  }
  return nextDate;
};
