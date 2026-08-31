import { Prisma } from '@prisma/client';

import {
  describeSuspiciousPriceJump,
  detectSuspiciousPriceJump,
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
