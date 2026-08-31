import { Prisma } from '@prisma/client';

import { InvariantInput, verifyPaperInvariants } from './paper-invariant';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const consistentInput = (): InvariantInput => ({
  seedAmount: decimal('1000'),
  cashBalance: decimal('947'),
  trades: [
    {
      side: 'BUY',
      quantity: decimal('2'),
      price: decimal('100'),
      fee: decimal('1'),
      tax: decimal('0'),
      tickerId: 1,
    },
    {
      side: 'SELL',
      quantity: decimal('1'),
      price: decimal('150'),
      fee: decimal('1'),
      tax: decimal('1'),
      tickerId: 1,
    },
  ],
  positions: [{ tickerId: 1, quantity: decimal('1') }],
});

describe('verifyPaperInvariants', () => {
  it('현금과 수량이 원장에 맞으면 위반이 없다', () => {
    expect(verifyPaperInvariants(consistentInput())).toEqual([]);
  });

  it('현금이 1원 어긋나면 CASH_MISMATCH를 반환한다', () => {
    const input = consistentInput();
    input.cashBalance = decimal('946');

    expect(verifyPaperInvariants(input)).toEqual([
      {
        kind: 'CASH_MISMATCH',
        detail: '현금 잔액 불일치: 원장 기준 947원, 실제 946원',
      },
    ]);
  });

  describe('배당 기업행동 원장 대조', () => {
    it('배당 현금만 더하면 CASH_MISMATCH를 반환한다', () => {
      const input = consistentInput();
      input.cashBalance = decimal('1331266');

      expect(verifyPaperInvariants(input)).toEqual([
        {
          kind: 'CASH_MISMATCH',
          detail: '현금 잔액 불일치: 원장 기준 947원, 실제 1331266원',
        },
      ]);
    });

    it('같은 현금을 기업행동 원장으로 기록하면 위반이 없다', () => {
      const input = consistentInput();
      input.cashBalance = decimal('1331266');
      input.corporateActions = [
        {
          tickerId: 1,
          cashDelta: decimal('1330319'),
          quantityDelta: decimal('0'),
        },
      ];

      expect(verifyPaperInvariants(input)).toEqual([]);
    });
  });

  it('포지션 수량이 거래 합계와 다르면 QUANTITY_MISMATCH를 반환한다', () => {
    const input = consistentInput();
    input.positions = [{ tickerId: 1, quantity: decimal('2') }];

    expect(verifyPaperInvariants(input)).toEqual([
      {
        kind: 'QUANTITY_MISMATCH',
        detail: '종목 1 수량 불일치: 원장 기준 1주, 실제 2주',
      },
    ]);
  });

  it('거래가 없고 현금이 시드와 같으면 위반이 없다', () => {
    expect(
      verifyPaperInvariants({
        seedAmount: decimal('1000'),
        cashBalance: decimal('1000'),
        trades: [],
        positions: [],
      }),
    ).toEqual([]);
  });
});
