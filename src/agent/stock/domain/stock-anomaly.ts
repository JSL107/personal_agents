import { DailyBar } from '../../../market-data/domain/market-data.type';
import { HoldingSnapshot, StockAnomaly } from './stock-monitor.type';

// 임계값 근거는 설계 문서 §5.4 — 최근 250거래일 등락 분포 실측.
// ±5% 는 주 1회 이상 울려 소음이 되고, ±8% 는 월 1.5~2.7회 수준이다.
export const STOCK_THRESHOLDS = {
  dailyChangePercent: 8,
  avgPriceLowerPercent: -20,
  avgPriceUpperPercent: 30,
} as const;

export const DAILY_CHANGE_RULE_VERSION = 1;
export const AVG_PRICE_BREACH_RULE_VERSION = 1;

type Thresholds = typeof STOCK_THRESHOLDS;

const percentChange = (current: DailyBar, base: DailyBar): number => {
  const currentValue = current.adjClose.toNumber();
  const baseValue = base.adjClose.toNumber();
  if (baseValue === 0) {
    return 0;
  }
  return ((currentValue - baseValue) / baseValue) * 100;
};

const percentAgainstAvgPrice = (
  bar: DailyBar,
  holding: HoldingSnapshot,
): number => {
  const avgPrice = holding.avgPrice.toNumber();
  if (avgPrice === 0) {
    return 0;
  }
  return ((bar.adjClose.toNumber() - avgPrice) / avgPrice) * 100;
};

// 전일 대비는 그날 발생한 사건이므로 상태 비교 없이 당일 값만 본다.
export const detectDailyChange = (
  holding: HoldingSnapshot,
  today: DailyBar,
  yesterday: DailyBar | null,
  thresholds: Thresholds = STOCK_THRESHOLDS,
): StockAnomaly | null => {
  if (!yesterday) {
    return null;
  }
  const change = percentChange(today, yesterday);
  if (Math.abs(change) <= thresholds.dailyChangePercent) {
    return null;
  }
  const direction = change > 0 ? '급등' : '급락';
  return {
    tickerName: holding.tickerName,
    yahooSymbol: holding.yahooSymbol,
    kind: 'DAILY_CHANGE',
    ruleId: 'daily-change',
    ruleVersion: DAILY_CHANGE_RULE_VERSION,
    triggeredValue: change,
    threshold: thresholds.dailyChangePercent,
    detail: `전일 대비 ${change.toFixed(1)}% ${direction}`,
  };
};

// 평단 대비는 상태이지 사건이 아니다. 한 번 임계를 넘으면 회복할 때까지 계속
// 임계 밖이므로, 매일 비교하면 같은 사실이 매일 발송된다.
// 따라서 "어제는 구간 밖 → 오늘 구간 안" 인 최초 진입에만 발화한다.
//
// 알려진 한계: 하한/상한을 하나의 boolean 으로 합치므로, 어제 하한(-20%↓)에서
// 오늘 상한(+30%↑)으로 직접 이동하면 알림이 억제된다. 그러나 국내 일일 상한이
// +30% 라 평단 대비 -21%→+31%(하루 +52%p)는 물리적으로 불가능하므로 실효 결함은
// 아니다. 미국 시장(상하한 없음)을 붙이는 Spec 2 에서 두 구간을 독립 상태로 분리한다.
const isBreached = (percent: number, thresholds: Thresholds): boolean => {
  if (percent <= thresholds.avgPriceLowerPercent) {
    return true;
  }
  return percent >= thresholds.avgPriceUpperPercent;
};

export const detectAvgPriceBreach = (
  holding: HoldingSnapshot,
  today: DailyBar,
  yesterday: DailyBar | null,
  thresholds: Thresholds = STOCK_THRESHOLDS,
): StockAnomaly | null => {
  if (!yesterday) {
    return null;
  }
  const todayPercent = percentAgainstAvgPrice(today, holding);
  const yesterdayPercent = percentAgainstAvgPrice(yesterday, holding);
  if (!isBreached(todayPercent, thresholds)) {
    return null;
  }
  if (isBreached(yesterdayPercent, thresholds)) {
    return null;
  }

  const isLower = todayPercent <= thresholds.avgPriceLowerPercent;
  const threshold = isLower
    ? thresholds.avgPriceLowerPercent
    : thresholds.avgPriceUpperPercent;
  const label = isLower ? '손실' : '수익';
  return {
    tickerName: holding.tickerName,
    yahooSymbol: holding.yahooSymbol,
    kind: 'AVG_PRICE_BREACH',
    ruleId: 'avg-price-breach',
    ruleVersion: AVG_PRICE_BREACH_RULE_VERSION,
    triggeredValue: todayPercent,
    threshold,
    detail: `평단 대비 ${todayPercent.toFixed(1)}% ${label} 구간 진입`,
  };
};
