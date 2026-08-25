import { Inject, Injectable, Logger } from '@nestjs/common';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { isIntradayCapture } from '../../market-data/domain/intraday-guard';
import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import {
  BenchmarkBar,
  MARKET_INDICATOR_PORT,
  MarketIndicatorPort,
} from '../../market-data/domain/port/market-indicator.port';
import {
  BenchmarkCloseWriteInput,
  BenchmarkPrismaRepository,
} from '../../market-data/infrastructure/benchmark.prisma.repository';
import {
  buildBackfillCursor,
  calculateBackfillStartDate,
} from '../domain/backfill-cursor';

const BENCHMARK_SYMBOL = 'KOSPI';
const DEFAULT_INCREMENTAL_DAYS = 5;
const DEFAULT_INITIAL_DAYS = 200;
const MAXIMUM_INCREMENTAL_DAYS = 200;
const BACKFILL_PAGE_SIZE = 200;
const MAXIMUM_BACKFILL_PAGES = 40;
const BACKFILL_PAGE_DELAY_MILLISECONDS = 250;
const RATE_LIMIT_RETRY_DELAY_MILLISECONDS = 1_000;
const CALENDAR_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface CollectBenchmarkOptions {
  days?: number;
  years?: number;
}

// 백필이 왜 끝났는지. 목표를 채워서 끝난 것과 상한에 걸려 끝난 것을 결과가 구분하지 못하면
// 목표에 못 미친 회차도 완료처럼 보인다.
export type BenchmarkBackfillStopReason =
  | 'alreadyCovered'
  | 'targetReached'
  | 'exhausted'
  | 'stalled'
  | 'pageLimit';

export interface CollectBenchmarkResult {
  symbol: string;
  fetched: number;
  written: number;
  blockedIntraday: number;
  latestTradeDate: string | null;
  pages: number;
  oldestTradeDate: string | null;
  // 증분(`days`) 경로는 백필이 아니므로 null 이다.
  stopReason: BenchmarkBackfillStopReason | null;
}

const findOldestBar = (bars: BenchmarkBar[]): BenchmarkBar => {
  return bars.reduce((oldest, bar) => {
    return bar.tradeDate < oldest.tradeDate ? bar : oldest;
  });
};

const findLatestBar = (bars: BenchmarkBar[]): BenchmarkBar => {
  return bars.reduce((latest, bar) => {
    return bar.tradeDate > latest.tradeDate ? bar : latest;
  });
};

const selectOldestTradeDate = (
  current: string | null,
  candidate: string,
): string => {
  if (current === null || candidate < current) {
    return candidate;
  }
  return current;
};

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

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
    if (options.days !== undefined && options.years !== undefined) {
      throw new Error('days와 years를 함께 지정할 수 없습니다.');
    }
    if (options.years !== undefined) {
      return await this.executeBackfill(options.years);
    }

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
      pages: 1,
      oldestTradeDate:
        safeBars.length === 0
          ? null
          : findOldestBar(safeBars).tradeDate.toISOString().slice(0, 10),
      stopReason: null,
    };
  }

  private async executeBackfill(
    years: number,
  ): Promise<CollectBenchmarkResult> {
    const latestTradeDate =
      await this.repository.findLatestTradeDate(BENCHMARK_SYMBOL);
    const storedOldestTradeDate =
      await this.repository.findOldestTradeDate(BENCHMARK_SYMBOL);
    const targetStartDate = calculateBackfillStartDate(
      getTodayKstDate(),
      years,
    );
    const now = new Date();
    const storedOldestDateText =
      storedOldestTradeDate?.toISOString().slice(0, 10) ?? null;

    // 커서를 저장된 최古일로 잡는 구조라, 이미 목표를 덮은 상태에서 그대로 루프에 들어가면
    // 그 최古일보다 더 과거를 한 장 더 받고서야 목표 도달로 끝난다. 같은 명령을 반복하면
    // 실행마다 200봉씩 목표 밖으로 밀려나므로 조회 전에 끊는다.
    if (
      storedOldestDateText !== null &&
      storedOldestDateText <= targetStartDate
    ) {
      return {
        symbol: BENCHMARK_SYMBOL,
        fetched: 0,
        written: 0,
        blockedIntraday: 0,
        latestTradeDate: latestTradeDate?.toISOString().slice(0, 10) ?? null,
        pages: 0,
        oldestTradeDate: storedOldestDateText,
        stopReason: 'alreadyCovered',
      };
    }

    let cursor =
      storedOldestTradeDate === null
        ? undefined
        : buildBackfillCursor(storedOldestTradeDate);
    let fetched = 0;
    let written = 0;
    let blockedIntraday = 0;
    let pages = 0;
    let oldestTradeDate: string | null = null;
    let fetchedLatestTradeDate: Date | null = null;
    // 루프를 조건으로 빠져나오면 상한에 걸린 것이다. 그 밖의 종료는 아래에서 덮어쓴다.
    let stopReason: BenchmarkBackfillStopReason = 'pageLimit';

    while (pages < MAXIMUM_BACKFILL_PAGES) {
      const bars = await this.fetchBackfillPage(cursor);
      pages += 1;
      fetched += bars.length;
      if (bars.length === 0) {
        stopReason = 'exhausted';
        break;
      }

      const oldestBar = findOldestBar(bars);
      const pageOldestTradeDate = oldestBar.tradeDate
        .toISOString()
        .slice(0, 10);
      oldestTradeDate = selectOldestTradeDate(
        oldestTradeDate,
        pageOldestTradeDate,
      );
      const cursorTradeDate = cursor?.slice(0, 10);
      if (
        cursorTradeDate !== undefined &&
        pageOldestTradeDate >= cursorTradeDate
      ) {
        stopReason = 'stalled';
        break;
      }

      const safeBars = bars.filter(
        (bar) => !isIntradayCapture(bar.tradeDate, now),
      );
      blockedIntraday += bars.length - safeBars.length;
      const rows: BenchmarkCloseWriteInput[] = safeBars.map((bar) => ({
        symbol: BENCHMARK_SYMBOL,
        tradeDate: bar.tradeDate,
        close: bar.close,
      }));
      written += await this.repository.upsertCloses(rows);
      if (safeBars.length > 0) {
        const pageLatestTradeDate = findLatestBar(safeBars).tradeDate;
        if (
          fetchedLatestTradeDate === null ||
          pageLatestTradeDate > fetchedLatestTradeDate
        ) {
          fetchedLatestTradeDate = pageLatestTradeDate;
        }
      }

      if (pageOldestTradeDate <= targetStartDate) {
        stopReason = 'targetReached';
        break;
      }
      cursor = buildBackfillCursor(oldestBar.tradeDate);
      if (pages < MAXIMUM_BACKFILL_PAGES) {
        await wait(BACKFILL_PAGE_DELAY_MILLISECONDS);
      }
    }

    const resultLatestTradeDate =
      latestTradeDate === null ||
      (fetchedLatestTradeDate !== null &&
        fetchedLatestTradeDate > latestTradeDate)
        ? fetchedLatestTradeDate
        : latestTradeDate;

    return {
      symbol: BENCHMARK_SYMBOL,
      fetched,
      written,
      blockedIntraday,
      latestTradeDate:
        resultLatestTradeDate?.toISOString().slice(0, 10) ?? null,
      pages,
      oldestTradeDate,
      stopReason,
    };
  }

  private async fetchBackfillPage(
    cursor: string | undefined,
  ): Promise<BenchmarkBar[]> {
    try {
      return await this.marketIndicator.fetchDailyCloses(
        BENCHMARK_SYMBOL,
        BACKFILL_PAGE_SIZE,
        { before: cursor },
      );
    } catch (error) {
      if (!(error instanceof MarketDataRateLimitError)) {
        throw error;
      }
      await wait(RATE_LIMIT_RETRY_DELAY_MILLISECONDS);
      return await this.marketIndicator.fetchDailyCloses(
        BENCHMARK_SYMBOL,
        BACKFILL_PAGE_SIZE,
        { before: cursor },
      );
    }
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
