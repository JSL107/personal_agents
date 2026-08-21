import { Prisma } from '@prisma/client';

import {
  aggregateRecommendationScores,
  matchRecommendationCycles,
  RecommendationOrderInput,
  RecommendationTradeInput,
} from './recommendation-score';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const order = (
  overrides: Partial<RecommendationOrderInput> = {},
): RecommendationOrderInput => ({
  id: 1,
  accountId: 10,
  tickerId: 100,
  side: 'BUY',
  strategy: 'LONG_TERM',
  status: 'FILLED',
  quantity: decimal('10'),
  ruleVersion: 2,
  ...overrides,
});

const trade = (
  overrides: Partial<RecommendationTradeInput> = {},
): RecommendationTradeInput => ({
  id: 11,
  orderId: 1,
  accountId: 10,
  tickerId: 100,
  side: 'BUY',
  quantity: decimal('10'),
  price: decimal('10'),
  fee: decimal('2'),
  tax: decimal('3'),
  realizedPnl: null,
  tradeDate: date('2026-08-01'),
  ...overrides,
});

describe('matchRecommendationCycles', () => {
  it('양쪽 비용을 포함한 정본 식으로 실제 수익률을 계산한다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade(),
        trade({
          id: 12,
          orderId: 2,
          side: 'SELL',
          price: decimal('12'),
          fee: decimal('4'),
          tax: decimal('1'),
          realizedPnl: decimal('10'),
          tradeDate: date('2026-08-06'),
        }),
      ],
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({
      classification: 'CLOSED',
      actualPnl: '10',
      actualReturnRate: '0.095238095238095238095',
      holdingDays: 5,
    });
    expect(result.realizedPnlMismatchCount).toBe(0);
  });

  it('보유 중 추천을 적중률 분모에서 제외하고 EXPIRED를 별도 집계한다', () => {
    const result = matchRecommendationCycles({
      orders: [
        order(),
        order({ id: 2, tickerId: 200, strategy: 'SWING' }),
        order({
          id: 3,
          tickerId: 300,
          strategy: 'SWING',
          status: 'EXPIRED',
        }),
        order({ id: 4, tickerId: 100, side: 'SELL' }),
      ],
      trades: [
        trade(),
        trade({ id: 21, orderId: 2, tickerId: 200 }),
        trade({
          id: 31,
          orderId: 4,
          side: 'SELL',
          price: decimal('11'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: decimal('5'),
          tradeDate: date('2026-08-02'),
        }),
      ],
    });
    const scores = aggregateRecommendationScores(result);

    expect(result.cycles.map((cycle) => cycle.classification)).toEqual([
      'CLOSED',
      'OPEN',
      'EXPIRED',
    ]);
    expect(scores).toEqual([
      expect.objectContaining({
        strategy: 'LONG_TERM',
        closedCount: 1,
        openCount: 0,
        expiredCount: 0,
        hitRate: '1',
      }),
      expect.objectContaining({
        strategy: 'SWING',
        closedCount: 0,
        openCount: 1,
        expiredCount: 1,
        hitRate: null,
      }),
    ]);
  });

  it('매수 전 매도와 소비되지 않은 매도를 각각 unmatched sell로 보고한다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade({
          id: 1,
          orderId: 2,
          side: 'SELL',
          tradeDate: date('2026-07-31'),
        }),
        trade(),
        trade({
          id: 30,
          orderId: 2,
          side: 'SELL',
          tradeDate: date('2026-08-02'),
        }),
        trade({
          id: 31,
          orderId: 2,
          side: 'SELL',
          tradeDate: date('2026-08-03'),
        }),
      ],
    });

    expect(result.cycles[0].sellTrade?.id).toBe(30);
    expect(
      result.anomalies
        .filter((anomaly) => anomaly.type === 'UNMATCHED_SELL')
        .map((anomaly) => anomaly.tradeId),
    ).toEqual([1, 31]);
  });

  it('매도는 같은 계좌와 종목에서만 한 번 소비한다', () => {
    const result = matchRecommendationCycles({
      orders: [
        order(),
        order({ id: 2, accountId: 20 }),
        order({ id: 3, side: 'SELL' }),
      ],
      trades: [
        trade(),
        trade({ id: 12, orderId: 2, accountId: 20 }),
        trade({
          id: 20,
          orderId: 3,
          side: 'SELL',
          tradeDate: date('2026-08-02'),
        }),
      ],
    });

    expect(result.cycles).toEqual([
      expect.objectContaining({ orderId: 1, classification: 'CLOSED' }),
      expect.objectContaining({ orderId: 2, classification: 'OPEN' }),
    ]);
    expect(result.cycles[0].sellTrade?.id).toBe(20);
  });

  it('수량 불일치와 저장 realizedPnl 불일치를 구조화된 이상치로 보고한다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade(),
        trade({
          id: 12,
          orderId: 2,
          side: 'SELL',
          quantity: decimal('9'),
          price: decimal('12'),
          fee: decimal('4'),
          tax: decimal('1'),
          realizedPnl: decimal('999'),
          tradeDate: date('2026-08-06'),
        }),
      ],
    });

    expect(result.anomalies.map((anomaly) => anomaly.type)).toEqual([
      'QUANTITY_MISMATCH',
      'REALIZED_PNL_MISMATCH',
    ]);
    expect(result.realizedPnlMismatchCount).toBe(1);
  });

  // 장부는 평단(나눗셈 → 소수 4자리 저장)으로, 채점은 매수 체결가로 실현손익을 낸다.
  // 완전 일치를 요구하던 시절 실제 원장에서 청산 13건 중 10건이 이 잔여만으로 이상치가 됐다.
  it('주당 반올림 한계 안의 실현손익 차이는 이상치로 세지 않는다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade({
          quantity: decimal('1000'),
          fee: decimal('0'),
          tax: decimal('0'),
        }),
        trade({
          id: 12,
          orderId: 2,
          side: 'SELL',
          quantity: decimal('1000'),
          price: decimal('11'),
          fee: decimal('0'),
          tax: decimal('0'),
          // 정확한 값은 1000. 주당 0.00005 원이 잘린 잔여라 허용치(주당 0.0001) 안이다.
          realizedPnl: decimal('1000.05'),
          tradeDate: date('2026-08-06'),
        }),
      ],
    });

    expect(result.anomalies).toEqual([]);
    expect(result.realizedPnlMismatchCount).toBe(0);
  });

  it('허용치를 넘는 실현손익 차이는 그대로 이상치로 잡는다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade({
          quantity: decimal('1000'),
          fee: decimal('0'),
          tax: decimal('0'),
        }),
        trade({
          id: 12,
          orderId: 2,
          side: 'SELL',
          quantity: decimal('1000'),
          price: decimal('11'),
          fee: decimal('0'),
          tax: decimal('0'),
          // 허용치는 1000 x 0.0001 = 0.1 원. 0.2 는 그 밖이다.
          realizedPnl: decimal('1000.2'),
          tradeDate: date('2026-08-06'),
        }),
      ],
    });

    expect(result.anomalies.map((anomaly) => anomaly.type)).toEqual([
      'REALIZED_PNL_MISMATCH',
    ]);
    expect(result.realizedPnlMismatchCount).toBe(1);
  });

  it('같은 날짜에는 trade id 순으로 첫 매도를 고른다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade(),
        trade({
          id: 13,
          orderId: 2,
          side: 'SELL',
          tradeDate: date('2026-08-02'),
        }),
        trade({
          id: 12,
          orderId: 2,
          side: 'SELL',
          tradeDate: date('2026-08-02'),
        }),
      ],
    });

    expect(result.cycles[0].sellTrade?.id).toBe(12);
  });

  it('입력 순서와 무관하게 먼저 체결된 BUY 추천이 SELL을 소비한다', () => {
    const result = matchRecommendationCycles({
      orders: [
        order({ id: 2 }),
        order({ id: 1 }),
        order({ id: 3, side: 'SELL' }),
      ],
      trades: [
        trade({ id: 20, orderId: 2, tradeDate: date('2026-08-02') }),
        trade({ id: 10, orderId: 1, tradeDate: date('2026-08-01') }),
        trade({
          id: 30,
          orderId: 3,
          side: 'SELL',
          tradeDate: date('2026-08-03'),
        }),
      ],
    });

    expect(result.cycles).toEqual([
      expect.objectContaining({
        orderId: 1,
        classification: 'CLOSED',
        sellTrade: expect.objectContaining({ id: 30 }),
      }),
      expect.objectContaining({ orderId: 2, classification: 'OPEN' }),
    ]);
  });

  it.each(['PENDING', 'PARTIALLY_FILLED', 'CANCELLED'] as const)(
    '%s BUY 추천을 누락하지 않고 상태 이상치와 함께 분류한다',
    (status) => {
      const result = matchRecommendationCycles({
        orders: [order({ status })],
        trades: [],
      });

      expect(result.cycles).toEqual([
        expect.objectContaining({
          orderId: 1,
          classification: 'ANOMALY',
        }),
      ]);
      expect(result.anomalies).toEqual([
        expect.objectContaining({
          type: 'UNEXPECTED_ORDER_STATUS',
          orderId: 1,
        }),
      ]);
    },
  );

  it('FILLED 체결 누락과 EXPIRED 체결 존재를 정상 세 버킷에서 제외한다', () => {
    const result = matchRecommendationCycles({
      orders: [
        order({ id: 1, status: 'FILLED' }),
        order({ id: 2, tickerId: 200, status: 'EXPIRED' }),
      ],
      trades: [trade({ id: 20, orderId: 2, tickerId: 200 })],
    });

    expect(result.cycles).toEqual([
      expect.objectContaining({ orderId: 1, classification: 'ANOMALY' }),
      expect.objectContaining({ orderId: 2, classification: 'ANOMALY' }),
    ]);
    expect(result.anomalies.map((anomaly) => anomaly.type)).toEqual([
      'MISSING_BUY_TRADE',
      'UNEXPECTED_ORDER_STATUS',
    ]);
    expect(aggregateRecommendationScores(result)[0]).toMatchObject({
      closedCount: 0,
      openCount: 0,
      expiredCount: 0,
      anomalyCount: 2,
    });
  });
});

describe('aggregateRecommendationScores', () => {
  it('청산 건의 평균·중앙값·최대 손실·평균 보유일수를 계산한다', () => {
    const orders = [
      order({ id: 1, tickerId: 101 }),
      order({ id: 2, tickerId: 102 }),
      order({ id: 3, tickerId: 103 }),
      order({ id: 11, tickerId: 101, side: 'SELL' }),
      order({ id: 12, tickerId: 102, side: 'SELL' }),
      order({ id: 13, tickerId: 103, side: 'SELL' }),
    ];
    const trades = [
      trade({
        id: 1,
        orderId: 1,
        tickerId: 101,
        fee: decimal('0'),
        tax: decimal('0'),
      }),
      trade({
        id: 2,
        orderId: 2,
        tickerId: 102,
        fee: decimal('0'),
        tax: decimal('0'),
      }),
      trade({
        id: 3,
        orderId: 3,
        tickerId: 103,
        fee: decimal('0'),
        tax: decimal('0'),
      }),
      trade({
        id: 11,
        orderId: 11,
        tickerId: 101,
        side: 'SELL',
        price: decimal('8'),
        fee: decimal('0'),
        tax: decimal('0'),
        realizedPnl: decimal('-20'),
        tradeDate: date('2026-08-02'),
      }),
      trade({
        id: 12,
        orderId: 12,
        tickerId: 102,
        side: 'SELL',
        price: decimal('11'),
        fee: decimal('0'),
        tax: decimal('0'),
        realizedPnl: decimal('10'),
        tradeDate: date('2026-08-04'),
      }),
      trade({
        id: 13,
        orderId: 13,
        tickerId: 103,
        side: 'SELL',
        price: decimal('14'),
        fee: decimal('0'),
        tax: decimal('0'),
        realizedPnl: decimal('40'),
        tradeDate: date('2026-08-07'),
      }),
    ];

    const [score] = aggregateRecommendationScores(
      matchRecommendationCycles({ orders, trades }),
    );

    expect(score).toMatchObject({
      recommendationCount: 3,
      closedCount: 3,
      hitCount: 2,
      hitRate: '0.66666666666666666667',
      meanReturnRate: '0.1',
      medianReturnRate: '0.1',
      maximumLoss: '-0.2',
      averageHoldingDays: '3.3333333333333333333',
    });
  });

  it('모든 청산 추천이 수익이면 최대 손실을 null로 둔다', () => {
    const result = matchRecommendationCycles({
      orders: [order(), order({ id: 2, side: 'SELL' })],
      trades: [
        trade({ fee: decimal('0'), tax: decimal('0') }),
        trade({
          id: 12,
          orderId: 2,
          side: 'SELL',
          price: decimal('11'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: decimal('10'),
          tradeDate: date('2026-08-02'),
        }),
      ],
    });

    expect(aggregateRecommendationScores(result)[0].maximumLoss).toBeNull();
  });
});
