import { Prisma } from '@prisma/client';

import { detectSuspiciousPriceJump } from './corporate-action-guard';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('detectSuspiciousPriceJump', () => {
  it('10대 1 액면분할에 가까운 급락을 의심으로 잡는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 1,
          previousClose: decimal('100000'),
          currentClose: decimal('10000'),
        },
      ]),
    ).toEqual([{ tickerId: 1, ratio: '0.1', suspectedRatio: '10' }]);
  });

  it('정상적인 5% 하락은 잡지 않는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 1,
          previousClose: decimal('100000'),
          currentClose: decimal('95000'),
        },
      ]),
    ).toEqual([]);
  });

  it('정수 분할비에서 먼 35% 급락은 잡지 않는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 1,
          previousClose: decimal('100000'),
          currentClose: decimal('65000'),
        },
      ]),
    ).toEqual([]);
  });

  it('5대 1 액면분할에 가까운 급락을 의심으로 잡는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 2,
          previousClose: decimal('50000'),
          currentClose: decimal('10000'),
        },
      ]),
    ).toEqual([{ tickerId: 2, ratio: '0.2', suspectedRatio: '5' }]);
  });

  it('이전 종가가 0이거나 음수면 판정하지 않는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 1,
          previousClose: decimal('0'),
          currentClose: decimal('10000'),
        },
        {
          tickerId: 2,
          previousClose: decimal('-100000'),
          currentClose: decimal('10000'),
        },
      ]),
    ).toEqual([]);
  });
});
