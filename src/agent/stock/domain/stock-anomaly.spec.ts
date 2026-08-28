import { Prisma } from '@prisma/client';

import {
  detectAvgPriceBreach,
  detectDailyChange,
  inspectAvgPriceStatus,
  isMarketClosed,
  measureAlertMargin,
} from './stock-anomaly';
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
  symbol: '005930',
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

describe('inspectAvgPriceStatus', () => {
  it('임계 안이면 아무 상태도 만들지 않는다', () => {
    expect(inspectAvgPriceStatus(holding, bar(105000))).toBeNull();
  });

  // detectAvgPriceBreach 는 최초 진입만 발화하므로 어제도 밖이던 종목은 영원히 침묵한다.
  // 그 종목이 여기서는 반드시 잡혀야 화면에서 사라지지 않는다.
  it('발화가 억제되는 종목도 상태로는 잡는다', () => {
    expect(detectAvgPriceBreach(holding, bar(64000), bar(60000))).toBeNull();

    expect(inspectAvgPriceStatus(holding, bar(64000))).toEqual({
      tickerName: 'SamsungElec',
      symbol: '005930',
      percent: -36,
      threshold: -20,
      // 화면이 "얼마에 사서 지금 얼마인지" 를 말하려면 판정값 밖의 이 넷이 함께 와야 한다.
      avgPrice: 100000,
      currentPrice: 64000,
      quantity: 10,
      currency: 'KRW',
    });
  });

  it('상한 밖이면 기준을 상한으로 돌려준다', () => {
    expect(inspectAvgPriceStatus(holding, bar(140000))).toEqual(
      expect.objectContaining({ percent: 40, threshold: 30 }),
    );
  });
});

describe('isMarketClosed', () => {
  it('마지막 봉 날짜가 직전 저장분과 같으면 휴장으로 본다', () => {
    expect(isMarketClosed(new Date('2026-07-21'), new Date('2026-07-21'))).toBe(
      true,
    );
  });

  it('새 거래일이면 휴장이 아니다', () => {
    expect(isMarketClosed(new Date('2026-07-22'), new Date('2026-07-21'))).toBe(
      false,
    );
  });

  it('직전 저장분이 없으면 휴장이 아니다(최초 실행)', () => {
    expect(isMarketClosed(new Date('2026-07-21'), null)).toBe(false);
  });
});

describe('measureAlertMargin', () => {
  // 평단 100,000 기준: 하루 등락 ±8% / 평단 대비 -20% ~ +30%
  it('두 축 중 경보선에 더 가까운 쪽을 고른다', () => {
    // 하루 +5% (여유 3%p) vs 평단 대비 +5% (상한까지 25%p) → 하루 축이 가깝다.
    const result = measureAlertMargin(holding, bar(105000), bar(100000));

    expect(result?.kind).toBe('DAILY_CHANGE');
    expect(result?.currentPercent).toBeCloseTo(5, 4);
    expect(result?.threshold).toBe(8);
    expect(result?.marginPoint).toBeCloseTo(3, 4);
  });

  it('평단 축이 더 가까우면 넘어설 쪽의 경보선을 든다', () => {
    // 하루 +1% (여유 7%p) vs 평단 대비 +28% (상한까지 2%p) → 평단 축.
    const result = measureAlertMargin(holding, bar(128000), bar(126732.67));

    expect(result?.kind).toBe('AVG_PRICE_BREACH');
    expect(result?.threshold).toBe(30);
    expect(result?.marginPoint).toBeCloseTo(2, 1);
  });

  it('평단 대비 하한이 가까우면 하한 경보선을 든다', () => {
    const result = measureAlertMargin(holding, bar(82000), bar(82000));

    expect(result?.kind).toBe('AVG_PRICE_BREACH');
    expect(result?.threshold).toBe(-20);
    expect(result?.marginPoint).toBeCloseTo(2, 4);
  });

  // 이미 넘은 축을 "남은 거리" 로 적으면 경보가 없다는 문장 옆에 음수 여유가 실린다.
  it('이미 임계 밖인 축은 후보에서 뺀다', () => {
    // 하루 +10% 로 일간 축은 이미 발화 구간, 평단 대비 +10% 는 아직 안이다.
    const result = measureAlertMargin(holding, bar(110000), bar(100000));

    expect(result?.kind).toBe('AVG_PRICE_BREACH');
    expect(result?.marginPoint).toBeCloseTo(20, 4);
  });

  it('두 축 모두 임계 밖이면 아무것도 돌려주지 않는다', () => {
    expect(measureAlertMargin(holding, bar(140000), bar(120000))).toBeNull();
  });

  it('전일 봉이 없으면 평단 축만 본다', () => {
    const result = measureAlertMargin(holding, bar(105000), null);

    expect(result?.kind).toBe('AVG_PRICE_BREACH');
  });
});
