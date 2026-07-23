import { DecimalValue } from '../../../market-data/domain/market-data.type';

export const DEFAULT_HORIZON_DAYS = 5;

export interface AlertOutcomeResult {
  returnPct: number;
}

export const scoreAlert = (
  firedPrice: DecimalValue,
  horizonPrice: DecimalValue,
): AlertOutcomeResult | null => {
  const firedPriceValue = firedPrice.toNumber();
  if (firedPriceValue === 0) {
    return null;
  }

  return {
    returnPct:
      ((horizonPrice.toNumber() - firedPriceValue) / firedPriceValue) * 100,
  };
};
