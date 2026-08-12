import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BenchmarkRepository } from '../../market-data/infrastructure/benchmark.repository';
import { TossMarketIndicatorClient } from '../../market-data/infrastructure/toss/toss-market-indicator.client';
import { CollectBenchmarkClosesUsecase } from './collect-benchmark-closes.usecase';

const benchmarkBar = (tradeDate: string, close: string) => ({
  tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
  close: new Prisma.Decimal(close),
});

const createFixture = (latestTradeDate: Date | null) => {
  const marketIndicator = {
    fetchDailyCloses: jest
      .fn()
      .mockResolvedValue([benchmarkBar('2026-08-11', '3210.24')]),
  };
  const repository = {
    findLatestTradeDate: jest.fn().mockResolvedValue(latestTradeDate),
    upsertCloses: jest.fn().mockResolvedValue(1),
  };
  return {
    usecase: new CollectBenchmarkClosesUsecase(
      marketIndicator as unknown as TossMarketIndicatorClient,
      repository as unknown as BenchmarkRepository,
    ),
    marketIndicator,
    repository,
  };
};

describe('CollectBenchmarkClosesUsecase', () => {
  it('첫 실행은 KOSPI 200봉을 조회해 저장한다', async () => {
    const fixture = createFixture(null);

    await expect(fixture.usecase.execute()).resolves.toEqual({
      symbol: 'KOSPI',
      fetched: 1,
      written: 1,
      blockedIntraday: 0,
      latestTradeDate: '2026-08-11',
    });
    expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledWith(
      'KOSPI',
      200,
    );
    expect(fixture.repository.upsertCloses).toHaveBeenCalledWith([
      {
        symbol: 'KOSPI',
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: new Prisma.Decimal('3210.24'),
      },
    ]);
  });

  it('저장 최신일이 20일 전이면 공백을 덮도록 KOSPI 20봉을 조회한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-11T15:10:00.000Z'));
    const fixture = createFixture(new Date('2026-07-23T00:00:00.000Z'));

    try {
      await fixture.usecase.execute();

      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledWith(
        'KOSPI',
        20,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('저장 최신일이 5일보다 가까우면 최소 KOSPI 5봉을 조회한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
    const fixture = createFixture(new Date('2026-08-10T00:00:00.000Z'));

    try {
      await fixture.usecase.execute();

      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledWith(
        'KOSPI',
        5,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('days를 지정하면 최초·증분 기본 봉수보다 우선한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
    const fixture = createFixture(new Date('2026-07-23T00:00:00.000Z'));

    try {
      await fixture.usecase.execute({ days: 30 });

      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledWith(
        'KOSPI',
        30,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    { boundary: '하한', latestTradeDate: '2026-08-07', expectedDays: 5 },
    { boundary: '상한', latestTradeDate: '2026-01-24', expectedDays: 200 },
  ])(
    '저장 최신일과 현재의 공백이 정확히 $boundary이면 $expectedDays봉을 요청하고 경고하지 않는다',
    async ({ latestTradeDate, expectedDays }) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
      const warning = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const fixture = createFixture(
        new Date(`${latestTradeDate}T00:00:00.000Z`),
      );

      try {
        await fixture.usecase.execute();

        expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledWith(
          'KOSPI',
          expectedDays,
        );
        expect(warning).not.toHaveBeenCalled();
      } finally {
        warning.mockRestore();
        jest.useRealTimers();
      }
    },
  );

  it('저장 최신일과 현재의 공백이 200일을 넘으면 상한 경고를 남긴다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T12:00:00.000Z'));
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const fixture = createFixture(new Date('2025-01-01T00:00:00.000Z'));

    try {
      await fixture.usecase.execute();

      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledWith(
        'KOSPI',
        200,
      );
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('KOSPI 벤치마크 공백이 API 상한 200봉을 초과'),
      );
    } finally {
      warning.mockRestore();
      jest.useRealTimers();
    }
  });

  it('장중 오늘 봉은 차단하고 과거 봉만 저장한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T05:00:00.000Z'));
    const fixture = createFixture(new Date('2026-08-10T00:00:00.000Z'));
    fixture.marketIndicator.fetchDailyCloses.mockResolvedValue([
      benchmarkBar('2026-08-11', '3210.24'),
      benchmarkBar('2026-08-12', '3215.68'),
    ]);

    try {
      await expect(fixture.usecase.execute()).resolves.toEqual({
        symbol: 'KOSPI',
        fetched: 2,
        written: 1,
        blockedIntraday: 1,
        latestTradeDate: '2026-08-11',
      });
      expect(fixture.repository.upsertCloses).toHaveBeenCalledWith([
        expect.objectContaining({
          tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('모든 조회 봉이 장중 차단되면 기존 최신 거래일을 유지한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T05:00:00.000Z'));
    const latestTradeDate = new Date('2026-08-11T00:00:00.000Z');
    const fixture = createFixture(latestTradeDate);
    fixture.marketIndicator.fetchDailyCloses.mockResolvedValue([
      benchmarkBar('2026-08-12', '3215.68'),
    ]);
    fixture.repository.upsertCloses.mockResolvedValue(0);

    try {
      await expect(fixture.usecase.execute()).resolves.toEqual({
        symbol: 'KOSPI',
        fetched: 1,
        written: 0,
        blockedIntraday: 1,
        latestTradeDate: '2026-08-11',
      });
      expect(fixture.repository.upsertCloses).toHaveBeenCalledWith([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('조회 응답이 저장된 최신일보다 오래되어도 최신 거래일을 후퇴시키지 않는다', async () => {
    const latestTradeDate = new Date('2026-08-11T00:00:00.000Z');
    const fixture = createFixture(latestTradeDate);
    fixture.marketIndicator.fetchDailyCloses.mockResolvedValue([
      benchmarkBar('2026-08-10', '3200.10'),
    ]);

    await expect(fixture.usecase.execute()).resolves.toEqual(
      expect.objectContaining({ latestTradeDate: '2026-08-11' }),
    );
  });
});
