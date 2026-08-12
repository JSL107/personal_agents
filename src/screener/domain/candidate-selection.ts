import { StockIndicator } from './indicator.type';

// 60일 평균 거래대금 5억원. 지표가 좋아도 이보다 얇으면 원하는 수량을 실제로 살 수 없다.
export const MINIMUM_TURNOVER = 500_000_000;
// 급증 상위에서 이만큼 추린 뒤 모멘텀으로 다시 자른다.
const SURGE_POOL_SIZE = 100;

const isLiquid = (indicator: StockIndicator): boolean => {
  return indicator.turnover60 >= MINIMUM_TURNOVER;
};

export const selectLongTermCandidates = (
  indicators: StockIndicator[],
  limit: number,
): StockIndicator[] => {
  return indicators
    .filter((indicator) => isLiquid(indicator) && indicator.isUptrend)
    .sort((left, right) => right.return120 - left.return120)
    .slice(0, limit);
};

export const selectSwingCandidates = (
  indicators: StockIndicator[],
  limit: number,
): StockIndicator[] => {
  return indicators
    .filter(isLiquid)
    .sort((left, right) => right.volumeSurge - left.volumeSurge)
    .slice(0, SURGE_POOL_SIZE)
    .sort((left, right) => right.return20 - left.return20)
    .slice(0, limit);
};
