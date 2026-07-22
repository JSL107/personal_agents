import { Prisma } from '@prisma/client';

import { detectAvgPriceBreach, detectDailyChange } from './stock-anomaly';
import { HoldingSnapshot } from './stock-monitor.type';

const bar = (adjClose: number) => ({
  tradeDate: new Date('2026-07-21T00:00:00.000Z'),
  close: new Prisma.Decimal(adjClose),
  adjClose: new Prisma.Decimal(adjClose),
  volume: 100n,
  currency: 'KRW',
});

const holding: HoldingSnapshot = {
  tickerName: 'SamsungElec',
  yahooSymbol: '005930.KS',
  quantity: new Prisma.Decimal(10),
  avgPrice: new Prisma.Decimal(100000),
};

describe('detectDailyChange', () => {
  it('임계값을 넘는 하락에 발화한다', () => {
    const result = detectDailyChange(holding, bar(91), bar(100));

    expect(result?.kind).toBe('DAILY_CHANGE');
    expect(result?.triggeredValue).toBeCloseTo(-9, 4);
  });

  it('임계값을 넘는 상승에 발화한다', () => {
    const result = detectDailyChange(holding, bar(109), bar(100));

    expect(result?.triggeredValue).toBeCloseTo(9, 4);
  });

  it('임계값 미만이면 발화하지 않는다', () => {
    expect(detectDailyChange(holding, bar(105), bar(100))).toBeNull();
  });

  it('경계값(정확히 8%)에서는 발화하지 않는다', () => {
    expect(detectDailyChange(holding, bar(108), bar(100))).toBeNull();
  });

  it('전일 봉이 없으면 판정하지 않는다', () => {
    expect(detectDailyChange(holding, bar(91), null)).toBeNull();
  });
});

describe('detectAvgPriceBreach', () => {
  // 평단 100,000 기준: -20% = 80,000 / +30% = 130,000
  it('하한 구간에 최초 진입하면 발화한다', () => {
    const result = detectAvgPriceBreach(holding, bar(79000), bar(85000));

    expect(result?.kind).toBe('AVG_PRICE_BREACH');
    expect(result?.triggeredValue).toBeCloseTo(-21, 4);
  });

  it('이미 하한 구간에 있었으면 발화하지 않는다', () => {
    expect(detectAvgPriceBreach(holding, bar(79000), bar(78000))).toBeNull();
  });

  it('상한 구간에 최초 진입하면 발화한다', () => {
    const result = detectAvgPriceBreach(holding, bar(131000), bar(125000));

    expect(result?.triggeredValue).toBeCloseTo(31, 4);
  });

  it('구간을 벗어났다가 재진입하면 다시 발화한다', () => {
    expect(
      detectAvgPriceBreach(holding, bar(79000), bar(81000)),
    ).not.toBeNull();
  });

  it('두 구간 모두 밖이면 발화하지 않는다', () => {
    expect(detectAvgPriceBreach(holding, bar(100000), bar(99000))).toBeNull();
  });

  // 두 규칙의 경계 처리는 의도적으로 다르다.
  // 전일대비는 "초과"(정확히 8% 는 미발화), 평단대비는 "이상/이하"(정확히 -20% 는 발화).
  // 평단대비는 구간 진입 여부를 보는 규칙이라 경계를 구간에 포함시킨다.
  it('경계값(정확히 -20%)에서 발화한다', () => {
    const result = detectAvgPriceBreach(holding, bar(80000), bar(85000));

    expect(result).not.toBeNull();
    expect(result?.triggeredValue).toBeCloseTo(-20, 4);
  });

  it('전일 봉이 없으면 판정하지 않는다', () => {
    expect(detectAvgPriceBreach(holding, bar(79000), null)).toBeNull();
  });
});
