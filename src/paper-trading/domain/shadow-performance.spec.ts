import { Prisma } from '@prisma/client';

import { RecommendationCycle } from './recommendation-score';
import {
  calculateBenchmarkPerformance,
  calculateShadowPerformance,
  ShadowDailyPriceInput,
} from './shadow-performance';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const cycle = (
  overrides: Partial<RecommendationCycle> = {},
): RecommendationCycle => ({
  orderId: 1,
  accountId: 10,
  tickerId: 100,
  strategy: 'SWING',
  classification: 'CLOSED',
  requestedQuantity: decimal('10000'),
  buyTrade: {
    id: 11,
    orderId: 1,
    accountId: 10,
    tickerId: 100,
    side: 'BUY',
    quantity: decimal('10000'),
    price: decimal('999999'),
    fee: decimal('0'),
    tax: decimal('0'),
    realizedPnl: null,
    tradeDate: date('2026-08-07'),
  },
  sellTrade: {
    id: 12,
    orderId: 2,
    accountId: 10,
    tickerId: 100,
    side: 'SELL',
    quantity: decimal('10000'),
    price: decimal('999999'),
    fee: decimal('0'),
    tax: decimal('0'),
    realizedPnl: decimal('0'),
    tradeDate: date('2026-08-14'),
  },
  actualPnl: '0',
  actualReturnRate: '0.1',
  holdingDays: 7,
  ...overrides,
});

const dailyPrice = (
  tradeDate: string,
  close: string,
  overrides: Partial<ShadowDailyPriceInput> = {},
): ShadowDailyPriceInput => ({
  tickerId: 100,
  market: 'KOSPI',
  tradeDate: date(tradeDate),
  close: decimal(close),
  ...overrides,
});

describe('calculateShadowPerformance', () => {
  it('주말을 세지 않고 진입 행 뒤 5번째 저장 행의 종가로 SWING 수익률을 계산한다', () => {
    const result = calculateShadowPerformance({
      cycles: [cycle()],
      dailyPrices: [
        dailyPrice('2026-08-07', '100'),
        dailyPrice('2026-08-10', '101'),
        dailyPrice('2026-08-11', '102'),
        dailyPrice('2026-08-12', '103'),
        dailyPrice('2026-08-13', '104'),
        dailyPrice('2026-08-14', '110'),
      ],
    });

    expect(result).toEqual({
      performances: [
        {
          orderId: 1,
          strategy: 'SWING',
          entryTradeDate: date('2026-08-07'),
          exitTradeDate: date('2026-08-14'),
          entryClose: '100',
          exitClose: '110',
          returnRate: '0.0973908852953350677',
        },
      ],
      shadowUnavailableCount: 0,
      shadowNotDueCount: 0,
    });
  });

  it('LONG_TERM 진입 뒤 저장 행이 60개 미만이면 그림자 미산출로 센다', () => {
    const dailyPrices = Array.from({ length: 60 }, (_, index) =>
      dailyPrice(
        `2026-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(
          1 + (index % 28),
        ).padStart(2, '0')}`,
        '100',
      ),
    );

    const result = calculateShadowPerformance({
      cycles: [
        cycle({
          strategy: 'LONG_TERM',
          buyTrade: {
            ...cycle().buyTrade!,
            tradeDate: dailyPrices[0].tradeDate,
          },
        }),
      ],
      dailyPrices,
    });

    expect(result.performances).toEqual([]);
    expect(result.shadowUnavailableCount).toBe(1);
  });

  it('PaperTrade.price 대신 양쪽 저장 close에 매수·매도 비용을 적용한다', () => {
    const result = calculateShadowPerformance({
      cycles: [cycle()],
      dailyPrices: [
        dailyPrice('2026-08-07', '100'),
        dailyPrice('2026-08-10', '100'),
        dailyPrice('2026-08-11', '100'),
        dailyPrice('2026-08-12', '100'),
        dailyPrice('2026-08-13', '100'),
        dailyPrice('2026-08-14', '100'),
      ],
    });

    expect(result.performances[0]).toMatchObject({
      entryClose: '100',
      exitClose: '100',
      returnRate: '-0.00237155889004645136',
    });
  });

  it('진입일 저장 close가 없으면 가까운 행으로 대체하지 않고 미산출로 센다', () => {
    const result = calculateShadowPerformance({
      cycles: [cycle()],
      dailyPrices: [dailyPrice('2026-08-10', '100')],
    });

    expect(result.performances).toEqual([]);
    expect(result.shadowUnavailableCount).toBe(1);
  });

  it('EXPIRED와 ANOMALY는 그림자 대상과 미산출 건수에서 제외한다', () => {
    const result = calculateShadowPerformance({
      cycles: [
        cycle({
          orderId: 2,
          classification: 'EXPIRED',
          buyTrade: null,
          sellTrade: null,
          actualPnl: null,
          actualReturnRate: null,
          holdingDays: null,
        }),
        cycle({
          orderId: 3,
          classification: 'ANOMALY',
          buyTrade: null,
          sellTrade: null,
          actualPnl: null,
          actualReturnRate: null,
          holdingDays: null,
        }),
      ],
      dailyPrices: [],
    });

    expect(result.performances).toEqual([]);
    expect(result.shadowUnavailableCount).toBe(0);
  });
});

describe('calculateBenchmarkPerformance', () => {
  it('진입일 KOSPI 종가가 없으면 nearest나 0으로 대체하지 않고 결손으로 센다', () => {
    const result = calculateBenchmarkPerformance({
      cycles: [cycle()],
      evaluationDate: date('2026-08-14'),
      dailyPrices: [],
      benchmarkCloses: [
        { tradeDate: date('2026-08-06'), close: decimal('100') },
        { tradeDate: date('2026-08-14'), close: decimal('110') },
      ],
    });

    expect(result).toEqual({
      performances: [],
      meanExcessReturnRate: null,
      benchmarkUnavailableCount: 1,
      evaluationBenchmarkMissing: false,
    });
  });

  it('고정 기간 KOSPI가 아니라 추천별 초과수익의 평균을 계산한다', () => {
    const secondCycle = cycle({
      orderId: 2,
      tickerId: 200,
      actualReturnRate: '0.2',
      buyTrade: {
        ...cycle().buyTrade!,
        id: 21,
        orderId: 2,
        tickerId: 200,
        tradeDate: date('2026-08-10'),
      },
      sellTrade: {
        ...cycle().sellTrade!,
        id: 22,
        tickerId: 200,
        tradeDate: date('2026-08-12'),
      },
    });

    const result = calculateBenchmarkPerformance({
      cycles: [cycle(), secondCycle],
      evaluationDate: date('2026-08-14'),
      dailyPrices: [],
      benchmarkCloses: [
        { tradeDate: date('2026-08-07'), close: decimal('100') },
        { tradeDate: date('2026-08-10'), close: decimal('100') },
        { tradeDate: date('2026-08-12'), close: decimal('80') },
        { tradeDate: date('2026-08-14'), close: decimal('200') },
      ],
    });

    expect(
      result.performances.map((performance) => performance.excessReturnRate),
    ).toEqual(['-0.9', '0.4']);
    expect(result.meanExcessReturnRate).toBe('-0.25');
    expect(result.benchmarkUnavailableCount).toBe(0);
  });

  it('OPEN은 실제 매수가와 평가일 저장 close의 비용 포함 미실현 수익률로 초과수익을 계산한다', () => {
    const openCycle = cycle({
      classification: 'OPEN',
      sellTrade: null,
      actualPnl: null,
      actualReturnRate: null,
      holdingDays: null,
      buyTrade: {
        ...cycle().buyTrade!,
        quantity: decimal('10000'),
        price: decimal('100'),
        fee: decimal('186'),
        tax: decimal('0'),
      },
    });

    const result = calculateBenchmarkPerformance({
      cycles: [openCycle],
      evaluationDate: date('2026-08-14'),
      dailyPrices: [dailyPrice('2026-08-14', '110')],
      benchmarkCloses: [
        { tradeDate: date('2026-08-07'), close: decimal('100') },
        { tradeDate: date('2026-08-14'), close: decimal('105') },
      ],
    });

    expect(result).toEqual({
      performances: [
        {
          orderId: 1,
          entryTradeDate: date('2026-08-07'),
          exitTradeDate: date('2026-08-14'),
          benchmarkReturnRate: '0.05',
          excessReturnRate: '0.0473908852953350677',
        },
      ],
      meanExcessReturnRate: '0.0473908852953350677',
      benchmarkUnavailableCount: 0,
      evaluationBenchmarkMissing: false,
    });
  });

  it.each([
    {
      name: '평가일 종목 close',
      dailyPrices: [],
      benchmarkCloses: [
        { tradeDate: date('2026-08-07'), close: decimal('100') },
        { tradeDate: date('2026-08-14'), close: decimal('105') },
      ],
    },
    {
      name: '평가일 KOSPI close',
      dailyPrices: [dailyPrice('2026-08-14', '110')],
      benchmarkCloses: [
        { tradeDate: date('2026-08-07'), close: decimal('100') },
        { tradeDate: date('2026-08-13'), close: decimal('105') },
      ],
    },
  ])(
    '$name 결손은 nearest 없이 한 번만 센다',
    ({ dailyPrices, benchmarkCloses }) => {
      const result = calculateBenchmarkPerformance({
        cycles: [
          cycle({
            classification: 'OPEN',
            sellTrade: null,
            actualPnl: null,
            actualReturnRate: null,
            holdingDays: null,
          }),
        ],
        evaluationDate: date('2026-08-14'),
        dailyPrices,
        benchmarkCloses,
      });

      expect(result.performances).toEqual([]);
      expect(result.meanExcessReturnRate).toBeNull();
      expect(result.benchmarkUnavailableCount).toBe(1);
    },
  );
});
