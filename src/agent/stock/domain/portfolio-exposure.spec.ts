import { Prisma } from '@prisma/client';

import {
  calculatePortfolioExposure,
  ExposurePosition,
  summarizePortfolioValue,
  ValuedPosition,
} from './portfolio-exposure';

const createPosition = (
  overrides: Partial<ExposurePosition> = {},
): ExposurePosition => ({
  region: 'KR',
  direction: 'LONG',
  currency: 'KRW',
  quantity: new Prisma.Decimal('1'),
  close: new Prisma.Decimal('100'),
  ...overrides,
});

const createValued = (
  overrides: Partial<ValuedPosition> = {},
): ValuedPosition => ({
  region: 'KR',
  direction: 'LONG',
  currency: 'KRW',
  quantity: new Prisma.Decimal('1'),
  close: new Prisma.Decimal('100'),
  avgPrice: new Prisma.Decimal('80'),
  previousClose: new Prisma.Decimal('90'),
  holdingDate: new Date('2026-08-21T00:00:00.000Z'),
  ...overrides,
});

describe('summarizePortfolioValue', () => {
  it('평가액과 원금 대비 손익을 낸다', () => {
    const result = summarizePortfolioValue(
      [
        createValued({
          quantity: new Prisma.Decimal('10'),
          close: new Prisma.Decimal('120'),
          avgPrice: new Prisma.Decimal('100'),
          previousClose: new Prisma.Decimal('110'),
        }),
      ],
      null,
    );

    expect(result).toEqual({
      totalValue: 1200,
      profit: 200,
      profitRate: 0.2,
      dailyChange: 100,
      dailyChangeRate: 100 / 1100,
    });
  });

  // 국내분만 더한 값을 "총자산" 으로 부르면 실제보다 작은 숫자가 매일 아침 사실처럼 도착한다.
  it('달러 보유가 있는데 환율이 없으면 아무 값도 내지 않는다', () => {
    const result = summarizePortfolioValue(
      [createValued(), createValued({ currency: 'USD' })],
      null,
    );

    expect(result).toBeNull();
  });

  it('달러 보유를 환율로 환산해 원화로 합산한다', () => {
    const result = summarizePortfolioValue(
      [
        createValued({
          currency: 'USD',
          quantity: new Prisma.Decimal('2'),
          close: new Prisma.Decimal('10'),
          avgPrice: new Prisma.Decimal('8'),
          previousClose: new Prisma.Decimal('9'),
        }),
      ],
      new Prisma.Decimal('1400'),
    );

    expect(result?.totalValue).toBe(28000);
    expect(result?.profit).toBe(5600);
    expect(result?.dailyChange).toBe(2800);
  });

  // 그 종목만 빼고 더하면 변화량은 작아지는데 비율은 남은 종목 기준이라 표본이 어긋난다.
  it('직전 종가가 없는 종목이 하나라도 있으면 전일 대비를 내지 않는다', () => {
    const result = summarizePortfolioValue(
      [createValued(), createValued({ previousClose: null })],
      null,
    );

    expect(result?.totalValue).toBe(200);
    expect(result?.dailyChange).toBeNull();
    expect(result?.dailyChangeRate).toBeNull();
  });

  it('보유가 없으면 아무 값도 내지 않는다', () => {
    expect(summarizePortfolioValue([], null)).toBeNull();
  });

  // 동기화는 전 종목을 한 회차에 갱신한다. 갈렸다면 그 회차가 일부만 반영된 것이고,
  // 조회는 성공하므로 이걸 보지 않으면 틀린 평가액이 정상 값처럼 발송된다.
  it('잔고 기준일이 종목마다 갈리면 부분 동기화이므로 아무 값도 내지 않는다', () => {
    const result = summarizePortfolioValue(
      [
        createValued(),
        createValued({ holdingDate: new Date('2026-08-20T00:00:00.000Z') }),
      ],
      null,
    );

    expect(result).toBeNull();
  });
});

describe('calculatePortfolioExposure', () => {
  it('원화 단일 통화 포지션의 비중을 계산한다', () => {
    const result = calculatePortfolioExposure(
      [
        createPosition({
          quantity: new Prisma.Decimal('2'),
          close: new Prisma.Decimal('50'),
        }),
      ],
      null,
    );

    expect(result).toEqual({
      buckets: [{ label: '한국 주식', ratio: 100 }],
      fxUsdRatio: 0,
    });
  });

  it('USD 포지션을 환율로 원화 환산해 전체 비중을 계산한다', () => {
    const result = calculatePortfolioExposure(
      [
        createPosition({
          region: 'US',
          currency: 'USD',
          quantity: new Prisma.Decimal('2'),
          close: new Prisma.Decimal('10'),
        }),
        createPosition({
          direction: 'SHORT',
          quantity: new Prisma.Decimal('5'),
          close: new Prisma.Decimal('1000'),
        }),
      ],
      new Prisma.Decimal('1000'),
    );

    expect(result).toEqual({
      buckets: [
        { label: '미국 주식', ratio: 80 },
        { label: '코스피 하락 베팅', ratio: 20 },
      ],
      fxUsdRatio: 80,
    });
  });

  it('미분류 USD 포지션도 달러 환노출에 포함한다', () => {
    const result = calculatePortfolioExposure(
      [
        createPosition({ region: null, currency: 'USD' }),
        createPosition({ region: 'US', currency: 'USD' }),
      ],
      new Prisma.Decimal('1'),
    );

    expect(result).toEqual({
      buckets: [
        { label: '미분류', ratio: 50 },
        { label: '미국 주식', ratio: 50 },
      ],
      fxUsdRatio: 100,
    });
  });

  it('USD 포지션에 환율이 없으면 부분 비중 대신 null을 반환한다', () => {
    const result = calculatePortfolioExposure(
      [createPosition({ region: 'US', currency: 'USD' })],
      null,
    );

    expect(result).toBeNull();
  });

  it('미분류 포지션을 임의 분류하지 않고 별도 버킷으로 계산한다', () => {
    const result = calculatePortfolioExposure(
      [
        createPosition({ region: 'US', quantity: new Prisma.Decimal('3') }),
        createPosition({ region: null }),
      ],
      null,
    );

    expect(result).toEqual({
      buckets: [
        { label: '미국 주식', ratio: 75 },
        { label: '미분류', ratio: 25 },
      ],
      fxUsdRatio: 75,
    });
  });

  it('같은 지역의 LONG과 SHORT를 서로 상쇄하지 않고 각각 계산한다', () => {
    const result = calculatePortfolioExposure(
      [
        createPosition({ region: 'US', quantity: new Prisma.Decimal('3') }),
        createPosition({
          region: 'US',
          direction: 'SHORT',
          quantity: new Prisma.Decimal('1'),
        }),
      ],
      null,
    );

    expect(result).toEqual({
      buckets: [
        { label: '미국 주식', ratio: 75 },
        { label: '미국 하락 베팅', ratio: 25 },
      ],
      fxUsdRatio: 100,
    });
  });
});
