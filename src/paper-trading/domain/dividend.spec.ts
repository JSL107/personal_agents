import { Prisma } from '@prisma/client';

import { calculateDividendAmounts } from './dividend';

describe('calculateDividendAmounts', () => {
  it('세전 배당에서 원천징수 세금과 순입금을 계산한다', () => {
    const amounts = calculateDividendAmounts({
      perShareAmount: new Prisma.Decimal('8640'),
      eligibleQuantity: new Prisma.Decimal('182'),
    });

    expect(amounts.gross.toString()).toBe('1572480');
    expect(amounts.tax.toString()).toBe('242161');
    expect(amounts.net.toString()).toBe('1330319');
  });
});
