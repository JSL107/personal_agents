import { HoldingChange } from '../domain/holding-change';
import { PortfolioExposure } from '../domain/portfolio-exposure';
import { STOCK_THRESHOLDS } from '../domain/stock-anomaly';
import {
  AvgPriceStatus,
  StockAnomaly,
  StockMarketCountry,
} from '../domain/stock-monitor.type';

export interface StockMonitorContext {
  checkedCount: number;
  lastTradeDate: string;
  failures: string[];
  marketClosed: boolean;
  marketCountry: StockMarketCountry;
  priceDisplays?: StockPriceDisplay[];
}

const MARKET_LABEL: Record<StockMarketCountry, string> = {
  KR: '국내',
  US: '미국',
};

// 판정 규칙을 화면에도 적는다. "이상 없음" 만 있으면 **무엇을 봤길래 이상이 없다는 것인지**
// 읽는 사람이 알 수 없다 — 감시가 죽어 아무것도 못 본 날과 글자가 똑같다.
const THRESHOLD_GUIDE =
  `_경보 기준: 하루 ±${STOCK_THRESHOLDS.dailyChangePercent}% 급등락 · ` +
  `평균 매입가 대비 ${STOCK_THRESHOLDS.avgPriceLowerPercent}% 아래 또는 ` +
  `+${STOCK_THRESHOLDS.avgPriceUpperPercent}% 위_`;

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

// 카드에 찍는 가격은 판정값이 아니라 읽히는 값이다. 원화 평단은 소수부가 길어(실측 1757.0445)
// 그대로 찍으면 숫자가 뭉개진다 — 원 단위로 반올림한다.
const formatDisplayPrice = (value: number, currency: string): string => {
  if (currency === 'KRW') {
    return `${formatKrw(Math.round(value).toString())}원`;
  }
  return `${currency} ${value.toFixed(2)}`;
};

// 퍼센트만으로는 "그래서 얼마"가 안 보인다. 부호는 손/익 라벨이 이미 말하므로 붙이지 않는다.
const formatValuationDelta = (status: AvgPriceStatus): string => {
  const delta = (status.currentPrice - status.avgPrice) * status.quantity;
  const label = delta < 0 ? '평가손' : '평가익';
  return `${label} ${formatDisplayPrice(Math.abs(delta), status.currency)}`;
};

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
  const exposureLine = `🌎 *자산 배분* — ${bucketText}`;
  if (exposure.fxUsdRatio === 0) {
    return exposureLine;
  }
  // "환노출 94%" 는 그 자체로는 좋은 상태인지 나쁜 상태인지 읽히지 않는다. 무엇이 달라지는지까지 적는다.
  return `${exposureLine}\n_달러 자산 ${exposure.fxUsdRatio}% — 환율이 내리면 원화 평가액도 함께 줄어듭니다_`;
};

// 평단 대비 임계 밖 종목의 **지속 상태**. 발화(사건)는 최초 진입 때만이라, 감시를 시작한 시점에
// 이미 구간 밖이던 종목은 알림이 영원히 안 뜬다 — 그 손실이 "이상 없음" 뒤에 가려지는 것을 막는다.
// 임계 안이면 빈 문자열이라 평상시에는 줄이 생기지 않는다.
export const formatAvgPriceStatuses = (statuses: AvgPriceStatus[]): string => {
  if (statuses.length === 0) {
    return '';
  }
  const lines = [
    `📌 *평균 매입가(산 가격)보다 크게 벌어진 ${statuses.length}종목*`,
  ];
  for (const status of statuses) {
    const boughtAt = formatDisplayPrice(status.avgPrice, status.currency);
    const nowAt = formatDisplayPrice(status.currentPrice, status.currency);
    lines.push(
      `• *${status.tickerName}* — ${boughtAt}에 사서 지금 ${nowAt}, ${status.percent.toFixed(1)}%`,
    );
    lines.push(
      `  ${formatQuantity(status.quantity.toString())} 보유 · ${formatValuationDelta(status)} (경보선 ${status.threshold}%)`,
    );
  }
  return lines.join('\n');
};

export const formatStockMonitorSummary = (
  anomalies: StockAnomaly[],
  context: StockMonitorContext,
): string => {
  const lines: string[] = [];

  const marketLabel = MARKET_LABEL[context.marketCountry];

  if (context.failures.length > 0) {
    // failures 에는 시세 조회 실패뿐 아니라 저장 실패·알림 복구 실패·채점용 보강 실패가 함께 담기고,
    // 그중에는 종목 단위가 아닌 항목(보강 조회 실패)도 있다. 원인은 아래 각 줄이 말하므로 헤더는 건수만 센다.
    lines.push(
      `⚠️ *주식 모니터링 — 점검하지 못한 항목 ${context.failures.length}건*`,
    );
    for (const failure of context.failures) {
      lines.push(`• ${failure}`);
    }
  }

  if (context.marketClosed) {
    // 관측한 사실(새 거래일 봉이 없다)과 추정(휴장)을 구분해 적는다. 시세 지연·수집 이상도 같은 조건을
    // 만들므로 "열리지 않았다" 로 단정하면 고장이 정상 휴장으로 읽힌다.
    lines.push(
      `📉 *주식 모니터링* — ${marketLabel} 새 거래일 시세가 없어 점검을 건너뜁니다 (휴장 추정, 마지막 거래일 ${context.lastTradeDate})`,
    );
    return lines.join('\n');
  }

  if (anomalies.length === 0) {
    lines.push(
      `📉 *주식 모니터링* — ${marketLabel} ${context.checkedCount}종목 점검, 새 경보 없음 (${context.lastTradeDate} 종가 기준)`,
    );
    lines.push(THRESHOLD_GUIDE);
    return lines.join('\n');
  }

  lines.push(
    `📉 *주식 모니터링* — ${marketLabel} ${context.checkedCount}종목 중 ${anomalies.length}건 경보 (${context.lastTradeDate} 종가 기준)`,
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
    const thresholdText =
      anomaly.kind === 'DAILY_CHANGE'
        ? `경보선 ±${anomaly.threshold}%`
        : `경보선 ${anomaly.threshold}%`;
    lines.push(
      `• ${tickerLabel} — ${anomaly.detail}${priceDisplay} (${thresholdText})`,
    );
  }
  return lines.join('\n');
};
