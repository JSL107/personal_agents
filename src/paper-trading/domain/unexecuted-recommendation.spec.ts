import { Prisma } from '@prisma/client';

import { ShadowDailyPriceInput } from './shadow-performance';
import {
  calculateUnexecutedRecommendations,
  UnexecutedRecommendationInput,
} from './unexecuted-recommendation';

const date = (day: number): Date =>
  new Date(`2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`);
const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const dailyPrice = (
  day: number,
  tickerId = 100,
  close = '100',
): ShadowDailyPriceInput => ({
  tickerId,
  market: 'KOSPI',
  tradeDate: date(day),
  close: decimal(close),
});
const recommendation = (
  day: number,
  overrides: Partial<UnexecutedRecommendationInput> = {},
): UnexecutedRecommendationInput => ({
  agentRunId: day,
  strategy: 'SWING',
  tickerId: 100,
  code: '005930',
  recommendedOn: date(day),
  ...overrides,
});
const marketDays = (lastDay: number): ShadowDailyPriceInput[] =>
  Array.from({ length: lastDay }, (_, index) => dailyPrice(index + 1));

describe('calculateUnexecutedRecommendations', () => {
  it('같은 종목의 연속 추천은 하나로 세고 보유 기간 뒤 재추천은 채택한다', () => {
    const result = calculateUnexecutedRecommendations({
      strategy: 'SWING',
      recommendations: [
        recommendation(1),
        recommendation(2),
        recommendation(6),
      ],
      dailyPrices: marketDays(11),
      benchmarkCloses: [],
    });

    expect(result).toMatchObject({
      recommendationCount: 3,
      duplicateCount: 1,
      unresolvedCount: 0,
      scoredCount: 2,
      notDueCount: 0,
      unavailableCount: 0,
    });
  });

  it('청산 거래일이 오지 않았으면 대기, 왔지만 종목 봉이 없으면 결손으로 센다', () => {
    const notDue = calculateUnexecutedRecommendations({
      strategy: 'SWING',
      recommendations: [recommendation(1)],
      dailyPrices: marketDays(5),
      benchmarkCloses: [],
    });
    const unavailable = calculateUnexecutedRecommendations({
      strategy: 'SWING',
      recommendations: [recommendation(1)],
      dailyPrices: [
        dailyPrice(1),
        ...marketDays(6)
          .slice(1)
          .map((price) => ({
            ...price,
            tickerId: 200,
          })),
      ],
      benchmarkCloses: [],
    });

    expect(notDue).toMatchObject({ notDueCount: 1, unavailableCount: 0 });
    expect(unavailable).toMatchObject({ notDueCount: 0, unavailableCount: 1 });
  });

  it('진입 봉이 없으면 결손, 티커를 못 찾으면 별도 미해결로 센다', () => {
    const result = calculateUnexecutedRecommendations({
      strategy: 'SWING',
      recommendations: [
        recommendation(1),
        recommendation(2, { tickerId: null }),
      ],
      dailyPrices: marketDays(6).slice(1),
      benchmarkCloses: [],
    });

    expect(result).toMatchObject({
      recommendationCount: 2,
      unresolvedCount: 1,
      unavailableCount: 1,
      scoredCount: 0,
    });
  });

  it('비용 반영 수익률로 적중을 판단하고 지수 결손은 초과수익만 제외한다', () => {
    const prices = marketDays(6);
    const flat = calculateUnexecutedRecommendations({
      strategy: 'SWING',
      recommendations: [recommendation(1)],
      dailyPrices: prices,
      benchmarkCloses: [],
    });
    const rising = calculateUnexecutedRecommendations({
      strategy: 'SWING',
      recommendations: [recommendation(1)],
      dailyPrices: prices.map((price, index) =>
        index === 5 ? { ...price, close: decimal('110') } : price,
      ),
      benchmarkCloses: [
        { tradeDate: date(1), close: decimal('100') },
        { tradeDate: date(6), close: decimal('105') },
      ],
    });

    expect(flat).toMatchObject({
      scoredCount: 1,
      hitCount: 0,
      hitRate: '0',
      meanExcessReturnRate: null,
      benchmarkUnavailableCount: 1,
    });
    expect(Number(flat.meanReturnRate)).toBeLessThan(0);
    expect(rising).toMatchObject({
      scoredCount: 1,
      hitCount: 1,
      hitRate: '1',
      benchmarkUnavailableCount: 0,
    });
    expect(Number(rising.meanReturnRate)).toBeGreaterThan(0);
    expect(Number(rising.meanExcessReturnRate)).toBeCloseTo(
      Number(rising.meanReturnRate) - 0.05,
    );
  });
});
