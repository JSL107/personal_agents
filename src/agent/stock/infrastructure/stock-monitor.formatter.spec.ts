import { StockAnomaly } from '../domain/stock-monitor.type';
import { formatStockMonitorSummary } from './stock-monitor.formatter';

const anomaly: StockAnomaly = {
  tickerName: 'SamsungElec',
  yahooSymbol: '005930.KS',
  kind: 'DAILY_CHANGE',
  ruleId: 'daily-change',
  ruleVersion: 1,
  triggeredValue: -9.2,
  threshold: 8,
  detail: '전일 대비 -9.2% 급락',
};

describe('formatStockMonitorSummary', () => {
  it('이상이 없으면 한 줄 하트비트를 만든다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: false,
    });

    expect(result).toContain('3종목');
    expect(result).toContain('2026-07-21');
  });

  it('휴장 추정이면 판정 생략을 밝힌다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: true,
    });

    expect(result).toContain('휴장');
  });

  it('발화한 종목의 규칙과 값을 담는다', () => {
    const result = formatStockMonitorSummary([anomaly], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: false,
    });

    expect(result).toContain('SamsungElec');
    expect(result).toContain('-9.2%');
    expect(result).toContain('8%');
  });

  it('미국 종목에 USD 현재가와 원화 환산액을 병기한다', () => {
    const unitedStatesAnomaly: StockAnomaly = {
      ...anomaly,
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };

    const result = formatStockMonitorSummary([unitedStatesAnomaly], {
      checkedCount: 1,
      lastTradeDate: '2026-07-23',
      failures: [],
      marketClosed: false,
      priceDisplays: [
        {
          yahooSymbol: 'AAPL',
          currency: 'USD',
          currentPrice: '327.74',
          convertedKrw: '483839',
        },
      ],
    });

    expect(result).toContain('USD 327.74');
    expect(result).toContain('₩483,839 상당');
    expect(result).toContain('🇺🇸 *AAPL*');
  });

  it('환율이 없는 미국 종목은 USD 현재가만 표시한다', () => {
    const unitedStatesAnomaly: StockAnomaly = {
      ...anomaly,
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };

    const result = formatStockMonitorSummary([unitedStatesAnomaly], {
      checkedCount: 1,
      lastTradeDate: '2026-07-23',
      failures: [],
      marketClosed: false,
      priceDisplays: [
        {
          yahooSymbol: 'AAPL',
          currency: 'USD',
          currentPrice: '327.74',
        },
      ],
    });

    expect(result).toContain('USD 327.74');
    expect(result).not.toContain('상당');
  });

  it('국내 종목은 기존 표시를 유지한다', () => {
    const result = formatStockMonitorSummary([anomaly], {
      checkedCount: 1,
      lastTradeDate: '2026-07-23',
      failures: [],
      marketClosed: false,
      priceDisplays: [
        {
          yahooSymbol: '005930.KS',
          currency: 'KRW',
          currentPrice: '273500',
          convertedKrw: '273500',
        },
      ],
    });

    expect(result).not.toContain('KRW 273500');
    expect(result).not.toContain('상당');
  });

  // 정상 침묵과 고장 침묵을 구분하는 것이 이 기능의 핵심 안전장치다.
  it('수집 실패가 있으면 반드시 드러낸다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 2,
      lastTradeDate: '2026-07-21',
      failures: ['247540.KQ: timeout'],
      marketClosed: false,
    });

    expect(result).toContain('수집 실패');
    expect(result).toContain('247540.KQ');
  });
});
