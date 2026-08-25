import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import { MarketIndicatorPort } from '../../market-data/domain/port/market-indicator.port';
import { BenchmarkPrismaRepository } from '../../market-data/infrastructure/benchmark.prisma.repository';
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
    findOldestTradeDate: jest.fn().mockResolvedValue(latestTradeDate),
    upsertCloses: jest.fn().mockResolvedValue(1),
  };
  return {
    usecase: new CollectBenchmarkClosesUsecase(
      marketIndicator as unknown as MarketIndicatorPort,
      repository as unknown as BenchmarkPrismaRepository,
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
      pages: 1,
      oldestTradeDate: '2026-08-11',
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
        pages: 1,
        oldestTradeDate: '2026-08-11',
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
        pages: 1,
        oldestTradeDate: null,
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

  it('days와 years를 함께 지정하면 조회 전에 거부한다', async () => {
    const fixture = createFixture(null);

    await expect(
      fixture.usecase.execute({ days: 200, years: 5 }),
    ).rejects.toThrow('days와 years를 함께 지정할 수 없습니다.');
    expect(fixture.marketIndicator.fetchDailyCloses).not.toHaveBeenCalled();
    expect(fixture.repository.findLatestTradeDate).not.toHaveBeenCalled();
  });

  it('years 지정 시 저장된 가장 오래된 날에서 시작해 이전 페이지의 가장 오래된 날로 커서를 잇는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
    const fixture = createFixture(new Date('2025-10-21T00:00:00.000Z'));
    fixture.repository.findOldestTradeDate.mockResolvedValue(
      new Date('2025-01-02T00:00:00.000Z'),
    );
    fixture.marketIndicator.fetchDailyCloses
      .mockResolvedValueOnce([
        benchmarkBar('2024-12-30', '2500.00'),
        benchmarkBar('2025-08-01', '2800.00'),
      ])
      .mockResolvedValueOnce([benchmarkBar('2020-08-24', '2300.00')]);
    fixture.repository.upsertCloses.mockResolvedValue(2);

    try {
      const execution = fixture.usecase.execute({ years: 5 });
      await jest.advanceTimersByTimeAsync(0);
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(249);
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);

      await expect(execution).resolves.toEqual({
        symbol: 'KOSPI',
        fetched: 3,
        written: 4,
        blockedIntraday: 0,
        latestTradeDate: '2025-10-21',
        pages: 2,
        oldestTradeDate: '2020-08-24',
      });
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenNthCalledWith(
        1,
        'KOSPI',
        200,
        { before: '2025-01-02T00:00:00.000+09:00' },
      );
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenNthCalledWith(
        2,
        'KOSPI',
        200,
        { before: '2024-12-30T00:00:00.000+09:00' },
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('첫 페이지에서 목표 시작일에 닿으면 추가 요청 없이 멈춘다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
    const fixture = createFixture(null);
    fixture.repository.findOldestTradeDate.mockResolvedValue(null);
    fixture.marketIndicator.fetchDailyCloses.mockResolvedValue([
      benchmarkBar('2020-08-24', '2300.00'),
      benchmarkBar('2026-08-24', '3200.00'),
    ]);
    fixture.repository.upsertCloses.mockResolvedValue(2);

    try {
      await expect(fixture.usecase.execute({ years: 5 })).resolves.toEqual(
        expect.objectContaining({ pages: 1, oldestTradeDate: '2020-08-24' }),
      );
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('빈 페이지가 오면 소진으로 보고 추가 요청 없이 멈춘다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
    const fixture = createFixture(null);
    fixture.repository.findOldestTradeDate.mockResolvedValue(null);
    fixture.marketIndicator.fetchDailyCloses.mockResolvedValue([]);
    fixture.repository.upsertCloses.mockResolvedValue(0);

    try {
      await expect(fixture.usecase.execute({ years: 5 })).resolves.toEqual({
        symbol: 'KOSPI',
        fetched: 0,
        written: 0,
        blockedIntraday: 0,
        latestTradeDate: null,
        pages: 1,
        oldestTradeDate: null,
      });
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(1);
      expect(fixture.repository.upsertCloses).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('커서 날짜와 같은 가장 오래된 봉이 반복되면 정체로 보고 한 페이지에서 멈춘다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
    const fixture = createFixture(new Date('2026-08-24T00:00:00.000Z'));
    fixture.repository.findOldestTradeDate.mockResolvedValue(
      new Date('2025-01-02T00:00:00.000Z'),
    );
    fixture.marketIndicator.fetchDailyCloses.mockResolvedValue([
      benchmarkBar('2025-01-02', '2500.00'),
      benchmarkBar('2025-08-01', '2800.00'),
    ]);

    try {
      const execution = fixture.usecase.execute({ years: 5 });
      await jest.runAllTimersAsync();

      await expect(execution).resolves.toEqual(
        expect.objectContaining({ pages: 1, oldestTradeDate: '2025-01-02' }),
      );
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('429는 같은 페이지를 1초 뒤 한 번 재시도한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
    const fixture = createFixture(null);
    fixture.repository.findOldestTradeDate.mockResolvedValue(null);
    fixture.marketIndicator.fetchDailyCloses
      .mockRejectedValueOnce(new MarketDataRateLimitError())
      .mockResolvedValueOnce([benchmarkBar('2020-08-24', '2300.00')]);

    try {
      const execution = fixture.usecase.execute({ years: 5 });
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(execution).resolves.toEqual(
        expect.objectContaining({ pages: 1, oldestTradeDate: '2020-08-24' }),
      );
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(2);
      expect(fixture.marketIndicator.fetchDailyCloses.mock.calls[0]).toEqual(
        fixture.marketIndicator.fetchDailyCloses.mock.calls[1],
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('목표와 소진에 닿지 않아도 40페이지에서 안전하게 멈춘다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-25T03:00:00.000Z'));
    const fixture = createFixture(null);
    fixture.repository.findOldestTradeDate.mockResolvedValue(null);
    fixture.marketIndicator.fetchDailyCloses.mockImplementation(async () => {
      const page = fixture.marketIndicator.fetchDailyCloses.mock.calls.length;
      const tradeDate = new Date(Date.UTC(2026, 7, 25 - page))
        .toISOString()
        .slice(0, 10);
      return [benchmarkBar(tradeDate, '3200.00')];
    });

    try {
      const execution = fixture.usecase.execute({ years: 5 });
      await jest.runAllTimersAsync();

      await expect(execution).resolves.toEqual(
        expect.objectContaining({ pages: 40 }),
      );
      expect(fixture.marketIndicator.fetchDailyCloses).toHaveBeenCalledTimes(
        40,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
