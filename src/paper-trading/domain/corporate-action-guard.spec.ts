import { Prisma } from '@prisma/client';

import {
  describeSuspiciousPriceJump,
  detectSuspiciousPriceJump,
  sumCurrentHoldingCorporateCash,
} from './corporate-action-guard';

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
    ).toEqual([{ tickerId: 1, ratio: '0.1' }]);
  });

  // 2026-08-28 코람코더원리츠 실측. 주당 8,640원 배당락으로 종가가 10,930원에서 2,335원이
  // 됐다. 정수비를 후보로 두던 옛 판정은 4:1·5:1 어느 쪽과도 5% 안에 들지 않아 이 종목을
  // 통과시켰고, 그 가격으로 장중 손절이 나가 계좌에 -156만원이 확정됐다.
  it('정수비가 아닌 배당락도 잡는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 178,
          previousClose: decimal('10930'),
          currentClose: decimal('2335'),
        },
      ]),
    ).toEqual([{ tickerId: 178, ratio: '0.21363220494053064959' }]);
  });

  it('주식병합처럼 값이 뛰는 방향도 잡는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 3,
          previousClose: decimal('1000'),
          currentClose: decimal('10000'),
        },
      ]),
    ).toEqual([{ tickerId: 3, ratio: '10' }]);
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

  // 하한가(-30%)와 상한가(+30%)는 실거래로 도달할 수 있는 값이라 통과시켜야 한다.
  // 여기서 잡으면 진짜 하한가를 친 날마다 평가가 멈춘다.
  it('가격제한 경계값은 잡지 않는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 1,
          previousClose: decimal('10000'),
          currentClose: decimal('7000'),
        },
        {
          tickerId: 2,
          previousClose: decimal('10000'),
          currentClose: decimal('13000'),
        },
      ]),
    ).toEqual([]);
  });

  it('가격제한을 넘긴 급락은 잡는다', () => {
    expect(
      detectSuspiciousPriceJump([
        {
          tickerId: 1,
          previousClose: decimal('100000'),
          currentClose: decimal('65000'),
        },
      ]),
    ).toEqual([{ tickerId: 1, ratio: '0.65' }]);
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

describe('describeSuspiciousPriceJump', () => {
  it('종목과 비율을 함께 알린다', () => {
    expect(
      describeSuspiciousPriceJump(
        { tickerId: 178, ratio: '0.2136' },
        '코람코더원리츠(417310)',
      ),
    ).toBe(
      '코람코더원리츠(417310) 가격이 전일 대비 0.2136배로 변했습니다 — ' +
        '하루 가격제한(±30%) 밖이라 분할·병합·배당락 또는 시세 오류로 봅니다.',
    );
  });
});

describe('sumCurrentHoldingCorporateCash', () => {
  const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
  const zero = new Prisma.Decimal(0);
  const buy = (tradeDate: string, quantity: string) => ({
    side: 'BUY' as const,
    quantity: new Prisma.Decimal(quantity),
    tradeDate: day(tradeDate),
  });
  const sell = (tradeDate: string, quantity: string) => ({
    ...buy(tradeDate, quantity),
    side: 'SELL' as const,
  });
  const dividend = (exDate: string, cashDelta: string) => ({
    exDate: day(exDate),
    cashDelta: new Prisma.Decimal(cashDelta),
    quantityDelta: zero,
  });

  it('지금 보유분이 받은 기업행동 현금만 더한다', () => {
    const cash = sumCurrentHoldingCorporateCash({
      trades: [buy('2026-08-24', '182')],
      corporateActions: [dividend('2026-08-28', '1330319')],
      zero,
    });

    expect(cash.toString()).toBe('1330319');
  });

  it('전량 정리하기 전 보유 때 받은 배당은 지금 보유분의 몫이 아니다', () => {
    const cash = sumCurrentHoldingCorporateCash({
      trades: [
        buy('2026-08-01', '10'),
        sell('2026-08-20', '10'),
        buy('2026-09-01', '10'),
      ],
      corporateActions: [
        dividend('2026-08-10', '500'),
        dividend('2026-09-10', '70'),
      ],
      zero,
    });

    expect(cash.toString()).toBe('70');
  });

  it('권리락일에 산 보유분은 그날 기업행동의 권리가 없다', () => {
    const cash = sumCurrentHoldingCorporateCash({
      trades: [buy('2026-08-28', '10')],
      corporateActions: [dividend('2026-08-28', '500')],
      zero,
    });

    expect(cash.toString()).toBe('0');
  });

  it('보유가 없으면 0 이다', () => {
    const cash = sumCurrentHoldingCorporateCash({
      trades: [buy('2026-08-01', '10'), sell('2026-08-20', '10')],
      corporateActions: [dividend('2026-08-10', '500')],
      zero,
    });

    expect(cash.toString()).toBe('0');
  });
});
