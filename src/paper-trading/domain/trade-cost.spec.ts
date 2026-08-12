import { Prisma } from '@prisma/client';

import { calculateTradeCost } from './trade-cost';

describe('calculateTradeCost', () => {
  it('KOSPI 매수에는 수수료만 적용하고 거래세는 적용하지 않는다', () => {
    const cost = calculateTradeCost({
      market: 'KOSPI',
      side: 'BUY',
      grossAmount: new Prisma.Decimal('1000000'),
      tradeDate: new Date('2026-08-11'),
    });

    expect(cost).toEqual({ fee: '186', tax: '0' });
  });

  it('KOSPI 매도에는 수수료와 거래세를 적용한다', () => {
    const cost = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount: new Prisma.Decimal('1000000'),
      tradeDate: new Date('2026-08-11'),
    });

    expect(cost).toEqual({ fee: '186', tax: '2000' });
  });

  it('KONEX 매도 세율은 KOSPI와 KOSDAQ보다 낮다', () => {
    const grossAmount = new Prisma.Decimal('1000000');
    const tradeDate = new Date('2026-08-11');

    const kospi = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount,
      tradeDate,
    });
    const kosdaq = calculateTradeCost({
      market: 'KOSDAQ',
      side: 'SELL',
      grossAmount,
      tradeDate,
    });
    const konex = calculateTradeCost({
      market: 'KONEX',
      side: 'SELL',
      grossAmount,
      tradeDate,
    });

    expect(kospi.tax).toBe('2000');
    expect(kosdaq.tax).toBe('2000');
    expect(konex.tax).toBe('1000');
  });

  it('2025-12-29 체결분부터 개정 세율을 적용한다', () => {
    const grossAmount = new Prisma.Decimal('1000000');
    const beforeChange = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount,
      tradeDate: new Date('2025-12-28'),
    });
    const afterChange = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount,
      tradeDate: new Date('2025-12-29'),
    });

    expect(beforeChange.tax).toBe('1500');
    expect(afterChange.tax).toBe('2000');
  });

  it('비용을 원 단위 정수로 절사한다', () => {
    const cost = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount: new Prisma.Decimal('12345'),
      tradeDate: new Date('2026-08-11'),
    });

    expect(cost).toEqual({ fee: '2', tax: '24' });
    expect(cost.fee).toMatch(/^\d+$/u);
    expect(cost.tax).toMatch(/^\d+$/u);
  });

  it('거래금액이 0이면 수수료와 세금도 0이다', () => {
    const cost = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount: new Prisma.Decimal('0'),
      tradeDate: new Date('2026-08-11'),
    });

    expect(cost).toEqual({ fee: '0', tax: '0' });
  });

  it('1원 미만 비용도 지수 표기 없이 0원으로 절사한다', () => {
    const cost = calculateTradeCost({
      market: 'KOSPI',
      side: 'SELL',
      grossAmount: new Prisma.Decimal('0.001'),
      tradeDate: new Date('2026-08-11'),
    });

    expect(cost).toEqual({ fee: '0', tax: '0' });
  });
});
