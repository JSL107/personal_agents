import { HoldingChange } from '../domain/holding-change';
import { PortfolioExposure } from '../domain/portfolio-exposure';
import { StockAnomaly } from '../domain/stock-monitor.type';
import {
  formatAvgPriceStatuses,
  formatHoldingChanges,
  formatPortfolioExposure,
  formatPortfolioValue,
  formatStockMonitorSummary,
} from './stock-monitor.formatter';

const change = (overrides: Partial<HoldingChange> = {}): HoldingChange => ({
  tickerId: 1,
  tickerName: 'KODEX 인버스',
  symbol: '114800',
  kind: 'INCREASED',
  previousQuantity: '50',
  quantity: '80',
  previousAvgPrice: '11044.7',
  avgPrice: '10800',
  currency: 'KRW',
  ...overrides,
});

const anomaly: StockAnomaly = {
  tickerName: 'SamsungElec',
  symbol: '005930',
  kind: 'DAILY_CHANGE',
  ruleId: 'daily-change',
  ruleVersion: 1,
  triggeredValue: -9.2,
  threshold: 8,
  detail: '전일 대비 -9.2% 급락',
};

describe('formatPortfolioExposure', () => {
  it('계산할 노출이 없으면 줄을 만들지 않는다', () => {
    expect(formatPortfolioExposure(null)).toBe('');
  });

  it('계산된 버킷 순서대로 비중과 달러 자산 비중을 보여준다', () => {
    const exposure: PortfolioExposure = {
      buckets: [
        { label: '미국 주식', ratio: 84 },
        { label: '코스피 하락 베팅', ratio: 15 },
        { label: '미분류', ratio: 1 },
      ],
      fxUsdRatio: 84,
    };

    expect(formatPortfolioExposure(exposure)).toBe(
      '🌎 *자산 배분* — 미국 주식 84% · 코스피 하락 베팅 15% · 미분류 1%\n' +
        '_달러 자산 84% — 환율이 내리면 원화 평가액도 함께 줄어듭니다_',
    );
  });

  it('달러 자산이 없으면 환율 설명 줄을 생략한다', () => {
    expect(
      formatPortfolioExposure({
        buckets: [{ label: '한국 주식', ratio: 100 }],
        fxUsdRatio: 0,
      }),
    ).toBe('🌎 *자산 배분* — 한국 주식 100%');
  });
});

describe('formatStockMonitorSummary', () => {
  it('이상이 없으면 한 줄 하트비트를 만든다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: false,
      marketCountry: 'KR',
    });

    expect(result).toContain('국내 3종목 점검, 새 경보 없음');
    expect(result).toContain('2026-07-21');
    // 경보 기준이 빠지면 "이상 없음" 이 감시가 죽은 날과 같은 글자가 된다.
    expect(result).toContain('하루 ±8% 급등락');
    expect(result).toContain('평균 매입가 대비 -20% 아래 또는 +30% 위');
  });

  it('휴장 추정이면 판정 생략을 밝힌다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: true,
      marketCountry: 'KR',
    });

    expect(result).toContain('국내 새 거래일 시세가 없어 점검을 건너뜁니다');
    expect(result).toContain('휴장 추정');
  });

  it('발화한 종목의 규칙과 값을 담는다', () => {
    const result = formatStockMonitorSummary([anomaly], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: false,
      marketCountry: 'KR',
    });

    expect(result).toContain('SamsungElec');
    expect(result).toContain('-9.2%');
    expect(result).toContain('경보선 ±8%');
  });

  it('미국 종목에 USD 현재가와 원화 환산액을 병기한다', () => {
    const unitedStatesAnomaly: StockAnomaly = {
      ...anomaly,
      tickerName: 'Apple',
      symbol: 'AAPL',
    };

    const result = formatStockMonitorSummary([unitedStatesAnomaly], {
      checkedCount: 1,
      lastTradeDate: '2026-07-23',
      failures: [],
      marketClosed: false,
      marketCountry: 'US',
      priceDisplays: [
        {
          symbol: 'AAPL',
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
      symbol: 'AAPL',
    };

    const result = formatStockMonitorSummary([unitedStatesAnomaly], {
      checkedCount: 1,
      lastTradeDate: '2026-07-23',
      failures: [],
      marketClosed: false,
      marketCountry: 'US',
      priceDisplays: [
        {
          symbol: 'AAPL',
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
      marketCountry: 'KR',
      priceDisplays: [
        {
          symbol: '005930',
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
      marketCountry: 'KR',
    });

    expect(result).toContain('점검하지 못한 항목 1건');
    expect(result).toContain('247540.KQ');
  });
});

describe('formatAvgPriceStatuses', () => {
  it('경보선 밖 종목이 없으면 줄을 만들지 않는다', () => {
    expect(formatAvgPriceStatuses([])).toBe('');
  });

  it('산 가격·현재가·보유수량·평가손을 함께 보여준다', () => {
    const result = formatAvgPriceStatuses([
      {
        tickerName: 'KODEX 인버스',
        symbol: '114800',
        percent: -35.68,
        threshold: -20,
        avgPrice: 3003.4523,
        currentPrice: 1932.5,
        quantity: 500,
        currency: 'KRW',
      },
    ]);

    expect(result).toBe(
      '📌 *평균 매입가(산 가격)보다 크게 벌어진 1종목*\n' +
        '• *KODEX 인버스* — 3,003원에 사서 지금 1,933원, -35.7%\n' +
        '  500주 보유 · 평가손 535,476원 (경보선 -20%)',
    );
  });

  it('상한 밖은 평가익으로 보여주고 달러는 USD 표기를 유지한다', () => {
    const result = formatAvgPriceStatuses([
      {
        tickerName: 'SPYM',
        symbol: 'SPYM',
        percent: 41.2,
        threshold: 30,
        avgPrice: 20,
        currentPrice: 28.24,
        quantity: 10,
        currency: 'USD',
      },
    ]);

    expect(result).toContain('USD 20.00에 사서 지금 USD 28.24, 41.2%');
    expect(result).toContain('평가익 USD 82.40 (경보선 30%)');
  });
});

describe('formatHoldingChanges', () => {
  // 매일 "변화 없음"을 보내면 소음이 된다. 0 건이 관측되어야 하는 곳은 화면이 아니라 원장이다.
  it('변화가 없으면 빈 문자열을 돌려 줄을 만들지 않는다', () => {
    expect(formatHoldingChanges([])).toBe('');
  });

  it('추가 매수를 수량과 평단 이동으로 보여준다', () => {
    const result = formatHoldingChanges([change()]);

    expect(result).toBe(
      '💼 *잔고 변화 1건*\n' +
        '• *KODEX 인버스* — 추가 매수 50주 → 80주, 평단 11,044.7원 → 10,800원',
    );
  });

  it('일부 매도를 추가 매수와 다른 말로 보여준다', () => {
    const result = formatHoldingChanges([
      change({
        kind: 'DECREASED',
        previousQuantity: '80',
        quantity: '50',
        previousAvgPrice: '10800',
        avgPrice: '10800',
      }),
    ]);

    expect(result).toContain('일부 매도 80주 → 50주, 평단 10,800원');
    expect(result).not.toContain('→ 10,800원');
  });

  it('신규 매수는 직전 값 없이 수량과 평단만 보여준다', () => {
    const result = formatHoldingChanges([
      change({
        kind: 'BOUGHT',
        previousQuantity: null,
        previousAvgPrice: null,
        quantity: '50',
        avgPrice: '11044.7',
      }),
    ]);

    expect(result).toContain('신규 매수 50주 (평단 11,044.7원)');
  });

  it('전량 매도는 팔기 전 수량을 보여준다', () => {
    const result = formatHoldingChanges([
      change({ kind: 'SOLD_ALL', previousQuantity: '50', quantity: '0' }),
    ]);

    expect(result).toContain('전량 매도 (50주)');
  });

  it('평단 변동은 수량이 유지됨을 함께 보여준다', () => {
    const result = formatHoldingChanges([
      change({
        kind: 'AVG_PRICE_CHANGED',
        previousQuantity: '50',
        quantity: '50',
      }),
    ]);

    expect(result).toContain('평단 변동 11,044.7원 → 10,800원 (50주 유지)');
  });

  it('미국 종목은 심볼과 통화를 그대로 보여준다', () => {
    const result = formatHoldingChanges([
      change({
        tickerName: '화이자',
        symbol: 'PFE',
        currency: 'USD',
        kind: 'BOUGHT',
        previousQuantity: null,
        previousAvgPrice: null,
        quantity: '62.0845',
        avgPrice: '26.8245',
      }),
    ]);

    expect(result).toContain(
      '🇺🇸 *PFE* — 신규 매수 62.0845주 (평단 USD 26.8245)',
    );
  });

  // 토스 실측값. 판정은 저장 정밀도(4자리)로 보므로 평단이 "안 움직였다"고 본 건인데,
  // 원본을 그대로 찍으면 화면만 "26.8245 → 26.824493" 으로 달라 보인다.
  it('브로커의 저장 정밀도 밖 자릿수는 잘라 화살표를 만들지 않는다', () => {
    const result = formatHoldingChanges([
      change({
        tickerName: '화이자',
        symbol: 'PFE',
        currency: 'USD',
        kind: 'DECREASED',
        previousQuantity: '70.5',
        quantity: '62.08454',
        previousAvgPrice: '26.8245',
        avgPrice: '26.824493',
      }),
    ]);

    expect(result).toContain('일부 매도 70.5주 → 62.0845주, 평단 USD 26.8245');
    expect(result).not.toContain('26.824493');
    expect(result).not.toContain('→ USD 26.8245');
  });

  it('원 미만에서 갈리는 평단을 같은 값으로 뭉개지 않는다', () => {
    const result = formatHoldingChanges([
      change({
        kind: 'AVG_PRICE_CHANGED',
        previousQuantity: '247',
        quantity: '247',
        previousAvgPrice: '1757.0445',
        avgPrice: '1757.9',
      }),
    ]);

    expect(result).toContain('평단 변동 1,757.0445원 → 1,757.9원');
  });
});

describe('formatPortfolioValue', () => {
  const base = {
    totalValue: 12_340_000,
    profit: 120_000,
    profitRate: 0.0098,
    dailyChange: -30_000,
    dailyChangeRate: -0.0024,
  };

  it('만원 단위로 줄이고 손익에 부호를 붙인다', () => {
    const text = formatPortfolioValue(base);

    expect(text).toContain('1,234만원');
    expect(text).toContain('+12만원 (+1.0%)');
    expect(text).toContain('-3만원 (-0.2%)');
  });

  // 원화 투입금 대비가 아니다 — 달러 매입 당시 환율을 잔고가 갖고 있지 않다.
  it('손익을 "원금 대비" 가 아니라 "매입가 대비" 로 적고 환율 고지를 함께 붙인다', () => {
    const text = formatPortfolioValue(base);

    expect(text).toContain('매입가 대비');
    expect(text).not.toContain('원금 대비');
    expect(text).toContain('환율이 움직인 몫은 빠져 있습니다');
  });

  it('만원 미만 손익은 원 단위로 적는다', () => {
    const text = formatPortfolioValue({
      ...base,
      profit: -3456,
      profitRate: -0.001,
    });

    expect(text).toContain('-3,456원');
  });

  it('전일 대비가 없으면 이유를 적는다', () => {
    const text = formatPortfolioValue({
      ...base,
      dailyChange: null,
      dailyChangeRate: null,
    });

    expect(text).toContain('시세가 하루치뿐인 종목이 있어 생략');
    // 고지는 전일 대비 유무와 무관하게 손익에도 걸린다.
    expect(text).toContain('환율이 움직인 몫은 빠져 있습니다');
  });

  it('값이 없으면 빈 문자열이라 줄이 생기지 않는다', () => {
    expect(formatPortfolioValue(null)).toBe('');
  });
});
