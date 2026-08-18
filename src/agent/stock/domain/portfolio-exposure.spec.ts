import { Prisma } from '@prisma/client';

import {
  calculatePortfolioExposure,
  ExposurePosition,
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
