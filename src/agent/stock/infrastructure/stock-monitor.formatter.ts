import { StockAnomaly } from '../domain/stock-monitor.type';

export interface StockMonitorContext {
  checkedCount: number;
  lastTradeDate: string;
  failures: string[];
  marketClosed: boolean;
  priceDisplays?: StockPriceDisplay[];
}

export interface StockPriceDisplay {
  yahooSymbol: string;
  currency: string;
  currentPrice: string;
  convertedKrw?: string;
}

const formatKrw = (value: string): string => {
  const integer = value.split('.')[0];
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
      (candidate) => candidate.yahooSymbol === anomaly.yahooSymbol,
    );
    const priceDisplay = formatPriceDisplay(stockPriceDisplay);
    const tickerLabel =
      stockPriceDisplay?.currency === 'USD'
        ? `🇺🇸 *${anomaly.yahooSymbol}*`
        : `*${anomaly.tickerName}*`;
    lines.push(
      `• ${tickerLabel} — ${anomaly.detail}${priceDisplay} (임계 ${anomaly.threshold}%)`,
    );
  }
  return lines.join('\n');
};
