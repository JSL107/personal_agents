import { HoldingChange } from '../domain/holding-change';
import {
  PortfolioExposure,
  PortfolioValue,
} from '../domain/portfolio-exposure';
import { STOCK_THRESHOLDS } from '../domain/stock-anomaly';
import {
  AlertMargin,
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
  // 기준일이 lastTradeDate 보다 이른 종목. 공급자 지연으로 종목마다 마지막 봉이 갈릴 수 있는데,
  // 헤더는 그중 최신 날짜 하나만 찍으므로 하루 묵은 값이 어제 값으로 읽힌다.
  olderBaseDates?: StockBaseDate[];
  // 경보선에 가장 가까운 종목 하나. 없으면(전 종목 임계 밖 등) 줄을 만들지 않는다.
  nearestMargin?: AlertMargin | null;
}

export interface StockBaseDate {
  symbol: string;
  tradeDate: string;
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

// 아침에 듣는 자산 한 줄. 노출 비중(어디에 쏠려 있나)과 다른 축이다 — 얼마이고 얼마 벌었나.
// 숫자만 적으면 "1,234만원" 이 좋은 상태인지 읽히지 않으므로 매입가 대비와 어제 대비를 함께 놓는다.
//
// **"원금 대비" 라고 쓰지 않는다.** 달러 보유의 매입 당시 환율을 우리는 모른다(잔고에 없다).
// 그래서 손익은 "달러로 얼마 벌었나를 지금 환율로 환산한 값" 이고, 원화를 얼마 넣어 얼마가
// 됐나와는 다르다. 환율이 매입 이후 움직였다면 그 차이만큼 갈린다.
export const formatPortfolioValue = (value: PortfolioValue | null): string => {
  if (!value) {
    return '';
  }
  const profitText = `${formatSignedMoney(value.profit)} (${formatSignedPercent(value.profitRate)})`;
  const headline = `💰 *내 자산* — ${formatAssetAmount(value.totalValue)} · 매입가 대비 ${profitText}`;
  const fxNote =
    '달러 자산은 지금 환율로 환산했습니다 — 두 숫자 모두 환율이 움직인 몫은 빠져 있습니다';
  if (value.dailyChange === null || value.dailyChangeRate === null) {
    // 직전 봉이 없는 종목이 섞이면 어제 대비를 내지 않는다. 줄이 통째로 빠지면 "왜 없지" 가
    // 되므로 이유를 적는다.
    return `${headline}\n_직전 거래일 대비는 시세가 하루치뿐인 종목이 있어 생략했습니다 · ${fxNote}_`;
  }
  return `${headline}\n_직전 거래일보다 ${formatSignedMoney(value.dailyChange)} (${formatSignedPercent(value.dailyChangeRate)}) · ${fxNote}_`;
};

const formatAssetAmount = (amount: number): string => {
  if (Math.abs(amount) < 10_000) {
    return `${Math.round(amount).toLocaleString('ko-KR')}원`;
  }
  return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만원`;
};

// 부호를 명시한다. "-3만원" 과 "3만원" 이 한 줄에 섞이면 어느 쪽이 손실인지 매번 다시 읽어야 한다.
const formatSignedMoney = (amount: number): string =>
  `${amount >= 0 ? '+' : '-'}${formatAssetAmount(Math.abs(amount))}`;

const formatSignedPercent = (rate: number): string =>
  `${rate >= 0 ? '+' : '-'}${(Math.abs(rate) * 100).toFixed(1)}%`;

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

// 종목마다 기준일이 다르면 그 사실을 적는다. 헤더의 "(YYYY-MM-DD 종가 기준)" 은 종목별
// 마지막 봉 중 **가장 최신 날짜** 하나라, 지연된 종목의 하루 전 값이 그 날짜 아래에 섞인다.
const formatOlderBaseDates = (baseDates?: StockBaseDate[]): string => {
  if (!baseDates || baseDates.length === 0) {
    return '';
  }
  const listed = baseDates
    .map((baseDate) => `${baseDate.symbol} ${baseDate.tradeDate}`)
    .join(' · ');
  // "하루 전" 이라고 쓰지 않는다. 뒤처진 폭은 종목마다 다르고 이틀 이상일 수도 있어
  // (그 종목만 봉을 못 받은 날이 이어지면 그렇게 된다) 단정하면 카드가 사실과 어긋난다.
  // 얼마나 뒤처졌는지는 함께 적은 날짜가 말한다.
  return `_기준일이 다른 종목: ${listed} — 최신 봉이 아직 안 들어와 이전 거래일 값입니다_`;
};

const MARGIN_AXIS_LABEL: Record<AlertMargin['kind'], string> = {
  DAILY_CHANGE: '하루 등락',
  AVG_PRICE_BREACH: '평균 매입가 대비',
};

// 같은 파일의 formatSignedPercent 는 비율(0.03)을 받아 ×100 하지만 이쪽은 이미 퍼센트인
// 값을 그대로 찍는다 — 판정이 퍼센트로 끝나므로 한 번 더 곱하면 값이 100배가 된다.
const formatMarginPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

// "새 경보 없음" 만으로는 오늘이 안전한 날인지 경보선 코앞인지 갈리지 않는다.
// 가장 가까운 종목 하나만 적는다 — 종목 수가 늘어도 줄 수가 늘지 않는다.
const formatNearestMargin = (margin?: AlertMargin | null): string => {
  if (!margin) {
    return '';
  }
  // 경보선은 설정값(±8 / -20 / +30)이라 소수부를 붙이지 않는다 — 아래 경보 기준 문구와
  // 같은 숫자가 한 카드 안에서 다르게 보이면 둘이 다른 값으로 읽힌다.
  const thresholdText =
    margin.kind === 'DAILY_CHANGE'
      ? `±${margin.threshold}%`
      : `${margin.threshold >= 0 ? '+' : ''}${margin.threshold}%`;
  return (
    `_경보선에 가장 가까운 종목: ${margin.tickerName} — ` +
    `${MARGIN_AXIS_LABEL[margin.kind]} ${formatMarginPercent(margin.currentPercent)}, ` +
    `경보선 ${thresholdText} 까지 ${margin.marginPoint.toFixed(1)}%p_`
  );
};

const pushIfPresent = (lines: string[], line: string): void => {
  if (line) {
    lines.push(line);
  }
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
    // 휴장 경로에서도 기준일은 갈릴 수 있다. 종목마다 마지막으로 저장된 거래일이 다르면
    // (그 종목만 봉을 못 받은 날이 있었으면) 전 종목에 새 봉이 없는 날에도 각자 다른 날짜에
    // 멈춰 있고, 아래 평단 상태 줄은 그 날짜의 가격으로 계산된다.
    pushIfPresent(lines, formatOlderBaseDates(context.olderBaseDates));
    return lines.join('\n');
  }

  if (anomalies.length === 0) {
    lines.push(
      `📉 *주식 모니터링* — ${marketLabel} ${context.checkedCount}종목 점검, 새 경보 없음 (${context.lastTradeDate} 종가 기준)`,
    );
    pushIfPresent(lines, formatOlderBaseDates(context.olderBaseDates));
    pushIfPresent(lines, formatNearestMargin(context.nearestMargin));
    lines.push(THRESHOLD_GUIDE);
    return lines.join('\n');
  }

  lines.push(
    `📉 *주식 모니터링* — ${marketLabel} ${context.checkedCount}종목 중 ${anomalies.length}건 경보 (${context.lastTradeDate} 종가 기준)`,
  );
  pushIfPresent(lines, formatOlderBaseDates(context.olderBaseDates));
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
