import { HoldingChange } from '../domain/holding-change';
import { PortfolioExposure } from '../domain/portfolio-exposure';
import { StockAnomaly } from '../domain/stock-monitor.type';

export interface StockMonitorContext {
  checkedCount: number;
  lastTradeDate: string;
  failures: string[];
  marketClosed: boolean;
  priceDisplays?: StockPriceDisplay[];
}

export interface StockPriceDisplay {
  symbol: string;
  currency: string;
  currentPrice: string;
  convertedKrw?: string;
}

// 소수부는 남긴다. 평단은 원 단위 밑에서 갈리는 값이라(실측 1757.0445) 잘라내면
// 서로 다른 두 평단이 같은 "1,757원" 으로 보인다.
const formatKrw = (value: string): string => {
  const [integer, fraction] = value.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
};

const formatPriceDisplay = (priceDisplay?: StockPriceDisplay): string => {
  if (!priceDisplay || priceDisplay.currency !== 'USD') {
    return '';
  }
  const parts = [`USD ${priceDisplay.currentPrice}`];
  if (priceDisplay.convertedKrw) {
    parts.push(`₩${formatKrw(priceDisplay.convertedKrw)} 상당`);
  }
  return ` (${parts.join(', ')})`;
};

// 판정과 같은 정밀도(Decimal(18,4))로 잘라서 보여준다. 토스는 그보다 긴 값을 주므로
// (실측: 평단 26.824493, 수량 62.08454) 원본을 그대로 찍으면 판정은 "변화 없음"이라 한 값에
// 화면만 "26.8245 → 26.824493" 으로 달라 보인다.
const STORED_SCALE = 10_000;

const atStoredScale = (value: string): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return (Math.round(parsed * STORED_SCALE) / STORED_SCALE).toString();
};

const formatMoney = (value: string, currency: string): string => {
  const scaled = atStoredScale(value);
  if (currency === 'KRW') {
    return `${formatKrw(scaled)}원`;
  }
  return `${currency} ${scaled}`;
};

const formatQuantity = (value: string): string => `${atStoredScale(value)}주`;

// 화살표는 눈에 보이는 차이가 있을 때만 찍는다. 표시 정밀도에서 같은 값이면 "1,757원 → 1,757원"
// 처럼 변화가 있는 것처럼 읽히는 줄이 된다.
const formatMoveOrValue = (
  previous: string | null,
  current: string,
  currency: string,
): string => {
  const currentText = formatMoney(current, currency);
  if (!previous) {
    return currentText;
  }
  const previousText = formatMoney(previous, currency);
  return previousText === currentText
    ? currentText
    : `${previousText} → ${currentText}`;
};

const describeHoldingChange = (change: HoldingChange): string => {
  const avgPriceText = formatMoveOrValue(
    change.previousAvgPrice,
    change.avgPrice,
    change.currency,
  );
  if (change.kind === 'BOUGHT') {
    return `신규 매수 ${formatQuantity(change.quantity)} (평단 ${avgPriceText})`;
  }
  if (change.kind === 'SOLD_ALL') {
    return `전량 매도 (${formatQuantity(change.previousQuantity ?? '0')})`;
  }
  if (change.kind === 'AVG_PRICE_CHANGED') {
    return `평단 변동 ${avgPriceText} (${formatQuantity(change.quantity)} 유지)`;
  }
  const label = change.kind === 'INCREASED' ? '추가 매수' : '일부 매도';
  return `${label} ${formatQuantity(change.previousQuantity ?? '0')} → ${formatQuantity(change.quantity)}, 평단 ${avgPriceText}`;
};

// 매매 사건 블록. 변화가 없으면 빈 문자열을 돌려 줄을 아예 만들지 않는다 — 매일 "변화 없음"은
// 소음이다. 변화 0 건이 관측되어야 하는 곳은 화면이 아니라 원장(agent_run.output)이다.
export const formatHoldingChanges = (changes: HoldingChange[]): string => {
  if (changes.length === 0) {
    return '';
  }
  const lines = [`💼 *잔고 변화 ${changes.length}건*`];
  for (const change of changes) {
    const tickerLabel =
      change.currency === 'USD'
        ? `🇺🇸 *${change.symbol}*`
        : `*${change.tickerName}*`;
    lines.push(`• ${tickerLabel} — ${describeHoldingChange(change)}`);
  }
  return lines.join('\n');
};

export const formatPortfolioExposure = (
  exposure: PortfolioExposure | null,
): string => {
  if (!exposure) {
    return '';
  }

  const bucketText = exposure.buckets
    .map((bucket) => `${bucket.label} ${bucket.ratio}%`)
    .join(' · ');
  const fxUsdText =
    exposure.fxUsdRatio === 0 ? '' : ` (달러 환노출 ${exposure.fxUsdRatio}%)`;
  return `🌎 ${bucketText}${fxUsdText}`;
};

export const formatStockMonitorSummary = (
  anomalies: StockAnomaly[],
  context: StockMonitorContext,
): string => {
  const lines: string[] = [];

  if (context.failures.length > 0) {
    lines.push(`⚠️ *주식 모니터링 — 수집 실패 ${context.failures.length}건*`);
    for (const failure of context.failures) {
      lines.push(`• ${failure}`);
    }
  }

  if (context.marketClosed) {
    lines.push(
      `📉 *주식 모니터링* — 휴장(추정), 판정 생략 (마지막 거래일 ${context.lastTradeDate})`,
    );
    return lines.join('\n');
  }

  if (anomalies.length === 0) {
    lines.push(
      `📉 *주식 모니터링* — ${context.checkedCount}종목 이상 없음 (${context.lastTradeDate})`,
    );
    return lines.join('\n');
  }

  lines.push(
    `📉 *주식 모니터링* — ${anomalies.length}건 발화 (${context.lastTradeDate})`,
  );
  for (const anomaly of anomalies) {
    const stockPriceDisplay = context.priceDisplays?.find(
      (candidate) => candidate.symbol === anomaly.symbol,
    );
    const priceDisplay = formatPriceDisplay(stockPriceDisplay);
    const tickerLabel =
      stockPriceDisplay?.currency === 'USD'
        ? `🇺🇸 *${anomaly.symbol}*`
        : `*${anomaly.tickerName}*`;
    lines.push(
      `• ${tickerLabel} — ${anomaly.detail}${priceDisplay} (임계 ${anomaly.threshold}%)`,
    );
  }
  return lines.join('\n');
};
