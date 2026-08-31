import { Prisma } from '@prisma/client';

import {
  calculateAccountValuation,
  calculatePendingDividendCash,
  calculatePositionValuation,
  calculatePurchasableCash,
  calculateUnsettledCash,
  findNextPayDate,
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

describe('calculateUnsettledCash', () => {
  it('결제일이 지나지 않은 매수·매도의 현금 효과만 합산한다', () => {
    const unsettledCash = calculateUnsettledCash({
      asOf: new Date('2026-08-11T00:00:00.000Z'),
      zero: decimal('0'),
      trades: [
        {
          side: 'BUY',
          quantity: decimal('10'),
          price: decimal('100'),
          fee: decimal('2'),
          tax: decimal('0'),
          settlementDate: new Date('2026-08-12T00:00:00.000Z'),
        },
        {
          side: 'SELL',
          quantity: decimal('3'),
          price: decimal('200'),
          fee: decimal('1'),
          tax: decimal('2'),
          settlementDate: new Date('2026-08-11T00:00:00.000Z'),
        },
        {
          side: 'BUY',
          quantity: decimal('1'),
          price: decimal('500'),
          fee: decimal('0'),
          tax: decimal('0'),
          settlementDate: null,
        },
      ],
    });

    expect(unsettledCash.toString()).toBe('-1002');
  });

  // 갓 개설해 거래가 없는 계좌도 평가를 돈다. 기준값을 거래에서 뽑으면 이 계좌에서
  // 뽑을 곳이 없어 평가 전체가 실패한다.
  it('거래가 한 건도 없으면 0을 반환한다', () => {
    const unsettledCash = calculateUnsettledCash({
      asOf: new Date('2026-08-11T00:00:00.000Z'),
      zero: decimal('0'),
      trades: [],
    });

    expect(unsettledCash.toString()).toBe('0');
  });
});

// 코람코더원리츠 특별배당의 실제 값. 8/28 권리락에 원장이 적히고 지급은 11/27 이라, 그 사이
// 석 달 동안 잔고 2,106,271 원 중 1,330,319 원은 아직 받지 않은 돈이다.
describe('calculatePendingDividendCash', () => {
  const dividend = {
    payDate: new Date('2026-11-27T00:00:00.000Z'),
    cashDelta: decimal('1330319'),
  };

  it('지급일이 오지 않은 배당을 합산한다', () => {
    expect(
      calculatePendingDividendCash({
        asOf: new Date('2026-08-31T00:00:00.000Z'),
        zero: decimal('0'),
        corporateActions: [dividend],
      }).toString(),
    ).toBe('1330319');
  });

  // 지급일에 상태를 바꾸는 작업이 없으므로, 그날이 지났다는 사실만으로 미수에서 빠져야 한다.
  // 빠지지 않으면 배당이 영영 못 쓰는 돈으로 남는다.
  it('지급일 당일부터는 미수에서 빠진다', () => {
    expect(
      calculatePendingDividendCash({
        asOf: new Date('2026-11-27T00:00:00.000Z'),
        zero: decimal('0'),
        corporateActions: [dividend],
      }).toString(),
    ).toBe('0');
  });

  // 지급일을 모르는 옛 기록까지 미수로 잡으면, 이미 쓴 돈이 갑자기 못 쓰는 돈이 된다.
  it('지급일이 없는 기록은 즉시 입금으로 본다', () => {
    expect(
      calculatePendingDividendCash({
        asOf: new Date('2026-08-31T00:00:00.000Z'),
        zero: decimal('0'),
        corporateActions: [{ payDate: null, cashDelta: decimal('500') }],
      }).toString(),
    ).toBe('0');
  });

  // 분할·병합은 cashDelta 가 0 이라 종류를 가리지 않아도 합에 섞이지 않는다.
  it('현금이 움직이지 않는 기업행동은 합에 영향을 주지 않는다', () => {
    expect(
      calculatePendingDividendCash({
        asOf: new Date('2026-08-31T00:00:00.000Z'),
        zero: decimal('0'),
        corporateActions: [
          dividend,
          {
            payDate: new Date('2026-12-01T00:00:00.000Z'),
            cashDelta: decimal('0'),
          },
        ],
      }).toString(),
    ).toBe('1330319');
  });
});

describe('calculatePurchasableCash', () => {
  it('잔고에서 미수 배당을 뺀 금액이 매수 여력이다', () => {
    expect(
      calculatePurchasableCash({
        cashBalance: decimal('2106271'),
        pendingDividendCash: decimal('1330319'),
      }).toString(),
    ).toBe('775952');
  });

  // 미수 배당으로 이미 매수가 나간 계좌는 잔고가 미수분보다 적을 수 있다. 음수를 그대로
  // 흘리면 제약 함수가 0 으로 깎기 전까지 여력처럼 돌아다닌다.
  it('미수가 잔고보다 크면 0 에서 끊는다', () => {
    expect(
      calculatePurchasableCash({
        cashBalance: decimal('100000'),
        pendingDividendCash: decimal('1330319'),
      }).toString(),
    ).toBe('0');
  });
});

describe('findNextPayDate', () => {
  it('미도래 기업행동 중 가장 이른 지급일을 고른다', () => {
    const payDate = findNextPayDate({
      asOf: new Date('2026-08-31T00:00:00.000Z'),
      corporateActions: [
        {
          payDate: new Date('2026-12-15T00:00:00.000Z'),
          cashDelta: decimal('100'),
        },
        {
          payDate: new Date('2026-11-27T00:00:00.000Z'),
          cashDelta: decimal('200'),
        },
        // 이미 지난 지급일이 가장 이르다고 뽑히면 카드가 지난 날짜를 예고한다.
        {
          payDate: new Date('2026-08-10T00:00:00.000Z'),
          cashDelta: decimal('300'),
        },
      ],
    });

    expect(payDate?.toISOString().slice(0, 10)).toBe('2026-11-27');
  });

  it('미도래 건이 없으면 null 이다', () => {
    expect(
      findNextPayDate({
        asOf: new Date('2026-11-27T00:00:00.000Z'),
        corporateActions: [
          {
            payDate: new Date('2026-11-27T00:00:00.000Z'),
            cashDelta: decimal('200'),
          },
        ],
      }),
    ).toBeNull();
  });
});
