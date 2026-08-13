import { Prisma } from '@prisma/client';

import {
  calculatePortfolioPerformance,
  PortfolioSnapshotInput,
  PortfolioTradeInput,
} from './portfolio-performance';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const snapshot = (
  tradeDate: string,
  totalValue: string,
  isBackfilled = false,
): PortfolioSnapshotInput => ({
  tradeDate: date(tradeDate),
  totalValue: decimal(totalValue),
  isBackfilled,
});

const trade = (
  overrides: Partial<PortfolioTradeInput> = {},
): PortfolioTradeInput => ({
  quantity: decimal('10'),
  price: decimal('10'),
  fee: decimal('2'),
  tax: decimal('3'),
  ...overrides,
});

describe('calculatePortfolioPerformance', () => {
  it('backfilled 스냅샷을 계좌 수익률과 MDD와 회전율 분모에서 제외한다', () => {
    const result = calculatePortfolioPerformance({
      seedAmount: decimal('1000'),
      snapshots: [
        snapshot('2026-08-01', '2000', true),
        snapshot('2026-08-02', '1200'),
        snapshot('2026-08-03', '600', true),
        snapshot('2026-08-04', '900'),
      ],
      trades: [trade()],
    });

    expect(result).toEqual({
      snapshotCount: 2,
      accountReturnRate: '-0.1',
      maximumDrawdown: '-0.25',
      turnoverRate: '0.095238095238095238095',
      cumulativeCost: '5',
    });
  });

  it('매수·매도 총 거래대금으로 회전율을, 양쪽 fee와 tax로 누적 비용을 계산한다', () => {
    const result = calculatePortfolioPerformance({
      seedAmount: decimal('1000'),
      snapshots: [snapshot('2026-08-01', '1000')],
      trades: [
        trade(),
        trade({
          quantity: decimal('5'),
          price: decimal('20'),
          fee: decimal('4'),
          tax: decimal('6'),
        }),
      ],
    });

    expect(result.turnoverRate).toBe('0.2');
    expect(result.cumulativeCost).toBe('15');
  });

  it('실측 스냅샷이 없으면 스냅샷 기반 지표만 null로 둔다', () => {
    const result = calculatePortfolioPerformance({
      seedAmount: decimal('1000'),
      snapshots: [snapshot('2026-08-01', '1000', true)],
      trades: [trade()],
    });

    expect(result).toEqual({
      snapshotCount: 0,
      accountReturnRate: null,
      maximumDrawdown: null,
      turnoverRate: null,
      cumulativeCost: '5',
    });
  });
});
