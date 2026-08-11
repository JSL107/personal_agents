import { Prisma } from '@prisma/client';

import { applyBuy, applySell } from './position-cost';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('applyBuy', () => {
  it('평균단가에 매수 수수료를 포함한다', () => {
    const outcome = applyBuy(
      { quantity: decimal('0'), avgPrice: decimal('0') },
      { quantity: decimal('10'), price: decimal('100'), fee: decimal('10') },
    );

    expect(outcome).toEqual({ quantity: '10', avgPrice: '101' });
  });

  it('기존 장부원가와 신규 매수원가를 수량 가중 평균한다', () => {
    const outcome = applyBuy(
      { quantity: decimal('10'), avgPrice: decimal('101') },
      { quantity: decimal('10'), price: decimal('199'), fee: decimal('10') },
    );

    expect(outcome).toEqual({ quantity: '20', avgPrice: '150.5' });
  });
});

describe('applySell', () => {
  it('부분 매도 후 평균단가는 변하지 않는다', () => {
    const outcome = applySell(
      { quantity: decimal('10'), avgPrice: decimal('101') },
      {
        quantity: decimal('4'),
        price: decimal('120'),
        fee: decimal('5'),
        tax: decimal('9'),
      },
    );

    expect(outcome.quantity).toBe('6');
    expect(outcome.avgPrice).toBe('101');
  });

  it('매도 순수취액에서 매도 수량의 장부원가를 빼 실현손익을 구한다', () => {
    const outcome = applySell(
      { quantity: decimal('10'), avgPrice: decimal('101') },
      {
        quantity: decimal('4'),
        price: decimal('120'),
        fee: decimal('5'),
        tax: decimal('9'),
      },
    );

    expect(outcome.realizedPnl).toBe('62');
  });

  it('보유 수량을 넘는 매도를 받은 값과 함께 거부한다', () => {
    expect(() =>
      applySell(
        { quantity: decimal('3'), avgPrice: decimal('100') },
        {
          quantity: decimal('4'),
          price: decimal('120'),
          fee: decimal('0'),
          tax: decimal('0'),
        },
      ),
    ).toThrow('보유 수량을 초과해 매도할 수 없습니다. 보유: 3, 매도: 4');
  });
});
