import { Inject, Injectable, Logger } from '@nestjs/common';

import { isIntradayCapture } from '../../market-data/domain/intraday-guard';
import {
  MARKET_INDICATOR_PORT,
  MarketIndicatorPort,
} from '../../market-data/domain/port/market-indicator.port';
import {
  BenchmarkCloseWriteInput,
  BenchmarkPrismaRepository,
} from '../../market-data/infrastructure/benchmark.prisma.repository';

const BENCHMARK_SYMBOL = 'KOSPI';
const DEFAULT_INCREMENTAL_DAYS = 5;
const DEFAULT_INITIAL_DAYS = 200;
const MAXIMUM_INCREMENTAL_DAYS = 200;
const CALENDAR_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface CollectBenchmarkOptions {
  days?: number;
}

export interface CollectBenchmarkResult {
  symbol: string;
  fetched: number;
  written: number;
  blockedIntraday: number;
  latestTradeDate: string | null;
}

@Injectable()
export class CollectBenchmarkClosesUsecase {
  private readonly logger = new Logger(CollectBenchmarkClosesUsecase.name);

  constructor(
    @Inject(MARKET_INDICATOR_PORT)
    private readonly marketIndicator: MarketIndicatorPort,
    private readonly repository: BenchmarkPrismaRepository,
  ) {}

  async execute(
    options: CollectBenchmarkOptions = {},
  ): Promise<CollectBenchmarkResult> {
    const latestTradeDate =
      await this.repository.findLatestTradeDate(BENCHMARK_SYMBOL);
    const now = new Date();
    // 거래일 수는 같은 기간의 캘린더 일수보다 항상 적으므로 캘린더 일수만큼 요청하면
    // 주말·휴장일을 포함해 저장 최신일 이후의 누락 거래일을 모두 덮을 수 있다.
    const calendarDaysSinceLatest =
      latestTradeDate === null
        ? null
        : countCalendarDaysSince({ latestTradeDate, now });

    // API 상한을 넘는 공백은 이번 한 번의 요청으로 복구할 수 없다. 조용히 자르면 최신일만
    // 전진해 자동 수집이 결손을 다시 발견하지 못하므로 페이지네이션 전까지 경고를 남긴다.
    if (
      calendarDaysSinceLatest !== null &&
      calendarDaysSinceLatest > MAXIMUM_INCREMENTAL_DAYS
    ) {
      this.logger.warn(
        `${BENCHMARK_SYMBOL} 벤치마크 공백이 API 상한 ${MAXIMUM_INCREMENTAL_DAYS}봉을 초과했습니다: latestTradeDate=${latestTradeDate?.toISOString().slice(0, 10)}, calendarDays=${calendarDaysSinceLatest}`,
      );
    }

    const days =
      options.days ??
      (latestTradeDate === null
        ? DEFAULT_INITIAL_DAYS
        : Math.min(
            Math.max(
              calendarDaysSinceLatest ?? DEFAULT_INCREMENTAL_DAYS,
              DEFAULT_INCREMENTAL_DAYS,
            ),
            MAXIMUM_INCREMENTAL_DAYS,
          ));
    const bars = await this.marketIndicator.fetchDailyCloses(
      BENCHMARK_SYMBOL,
      days,
    );
    const safeBars = bars.filter(
      (bar) => !isIntradayCapture(bar.tradeDate, now),
    );
    const rows: BenchmarkCloseWriteInput[] = safeBars.map((bar) => ({
      symbol: BENCHMARK_SYMBOL,
      tradeDate: bar.tradeDate,
      close: bar.close,
    }));
    const written = await this.repository.upsertCloses(rows);
    const fetchedLatestTradeDate = safeBars.at(-1)?.tradeDate ?? null;
    const resultLatestTradeDate =
      latestTradeDate === null ||
      (fetchedLatestTradeDate !== null &&
        fetchedLatestTradeDate > latestTradeDate)
        ? fetchedLatestTradeDate
        : latestTradeDate;

    return {
      symbol: BENCHMARK_SYMBOL,
      fetched: bars.length,
      written,
      blockedIntraday: bars.length - safeBars.length,
      latestTradeDate:
        resultLatestTradeDate?.toISOString().slice(0, 10) ?? null,
    };
  }
}

const countCalendarDaysSince = ({
  latestTradeDate,
  now,
}: {
  latestTradeDate: Date;
  now: Date;
}): number => {
  const currentKstDateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const currentKstDatePart = (type: Intl.DateTimeFormatPartTypes): string => {
    return (
      currentKstDateParts.find((candidate) => candidate.type === type)?.value ??
      ''
    );
  };
  const currentDate = Date.UTC(
    Number(currentKstDatePart('year')),
    Number(currentKstDatePart('month')) - 1,
    Number(currentKstDatePart('day')),
  );
  const storedDate = Date.UTC(
    latestTradeDate.getUTCFullYear(),
    latestTradeDate.getUTCMonth(),
    latestTradeDate.getUTCDate(),
  );
  const elapsedMilliseconds = currentDate - storedDate;
  const calendarDays = Math.floor(
    elapsedMilliseconds / CALENDAR_DAY_MILLISECONDS,
  );

  return Math.max(calendarDays, 0);
};
