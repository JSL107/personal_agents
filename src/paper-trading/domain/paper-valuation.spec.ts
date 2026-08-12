import { Prisma } from '@prisma/client';

import {
  calculateAccountValuation,
  calculatePositionValuation,
} from './paper-valuation';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('calculatePositionValuation', () => {
  it('단일 포지션의 평가액과 수익률을 계산한다', () => {
    const valuation = calculatePositionValuation(
      {
        tickerId: 1,
        quantity: decimal('10'),
        avgPrice: decimal('100'),
        price: decimal('120'),
        priceDate: new Date('2026-08-11'),
      },
      new Date('2026-08-11'),
    );

    expect(valuation).toEqual({
      tickerId: 1,
      marketValue: '1200',
      costBasis: '1000',
      unrealizedPnl: '200',
      returnRate: '20',
      isStale: false,
    });
  });
});

describe('calculateAccountValuation', () => {
  it('여러 포지션 평가액을 현금과 합산한다', () => {
    const valuation = calculateAccountValuation({
      seedAmount: decimal('2500'),
      cashBalance: decimal('500'),
      tradeDate: new Date('2026-08-11'),
      positions: [
        {
          tickerId: 1,
          quantity: decimal('10'),
          avgPrice: decimal('100'),
          price: decimal('120'),
          priceDate: new Date('2026-08-11'),
        },
        {
          tickerId: 2,
          quantity: decimal('5'),
          avgPrice: decimal('200'),
          price: decimal('220'),
          priceDate: new Date('2026-08-11'),
        },
      ],
    });

    expect(valuation.positionValue).toBe('2300');
    expect(valuation.totalValue).toBe('2800');
    expect(valuation.returnRate).toBe('12');
  });

  it('가격 거래일이 평가 거래일과 다르면 stale로 집계한다', () => {
    const valuation = calculateAccountValuation({
      seedAmount: decimal('1000'),
      cashBalance: decimal('0'),
      tradeDate: new Date('2026-08-11'),
      positions: [
        {
          tickerId: 1,
          quantity: decimal('10'),
          avgPrice: decimal('100'),
          price: decimal('90'),
          priceDate: new Date('2026-08-08'),
        },
      ],
    });

    expect(valuation.positions[0].isStale).toBe(true);
    expect(valuation.staleTickerCount).toBe(1);
  });

  it('포지션이 없으면 현금만으로 계좌를 평가한다', () => {
    const valuation = calculateAccountValuation({
      seedAmount: decimal('1000'),
      cashBalance: decimal('900'),
      tradeDate: new Date('2026-08-11'),
      positions: [],
    });

    expect(valuation).toEqual({
      positions: [],
      positionValue: '0',
      totalValue: '900',
      returnRate: '-10',
      staleTickerCount: 0,
    });
  });

  it('계좌 수익률을 시드 대비 백분율로 계산한다', () => {
    const valuation = calculateAccountValuation({
      seedAmount: decimal('1000'),
      cashBalance: decimal('500'),
      tradeDate: new Date('2026-08-11'),
      positions: [
        {
          tickerId: 1,
          quantity: decimal('5'),
          avgPrice: decimal('100'),
          price: decimal('120'),
          priceDate: new Date('2026-08-11'),
        },
      ],
    });

    expect(valuation.totalValue).toBe('1100');
    expect(valuation.returnRate).toBe('10');
  });
});
