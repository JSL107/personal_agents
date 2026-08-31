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
      unrealizedPnl: '0',
      // 들고 있는 것이 없는데 현금이 시드보다 적다 — 차액은 전부 팔아서 확정한 손실이다.
      realizedPnl: '-100',
      staleTickerCount: 0,
    });
  });

  // 2026-08-28 카드가 읽히지 않았던 모양 그대로. 보유 종목은 평가이익인데 총 수익률은
  // 마이너스라, 두 값을 가르지 않으면 화면만 보고는 무슨 일이 있었는지 알 수 없다.
  it('보유분이 이익이어도 확정 손실이 크면 총 수익률은 마이너스로 갈린다', () => {
    const valuation = calculateAccountValuation({
      seedAmount: decimal('10000'),
      cashBalance: decimal('2000'),
      tradeDate: new Date('2026-08-28'),
      positions: [
        {
          tickerId: 1,
          quantity: decimal('10'),
          avgPrice: decimal('500'),
          price: decimal('600'),
          priceDate: new Date('2026-08-28'),
        },
      ],
    });

    expect(valuation.totalValue).toBe('8000');
    expect(valuation.returnRate).toBe('-20');
    expect(valuation.unrealizedPnl).toBe('1000');
    expect(valuation.realizedPnl).toBe('-3000');
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
