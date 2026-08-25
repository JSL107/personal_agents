import { Inject, Injectable, Logger } from '@nestjs/common';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { DailyBar } from '../../market-data/domain/market-data.type';
import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import {
  DailyPriceWriteInput,
  MarketDataPrismaRepository,
  UniverseTicker,
} from '../../market-data/infrastructure/market-data.prisma.repository';
import {
  buildBackfillCursor,
  calculateBackfillStartDate,
} from '../domain/backfill-cursor';

const DEFAULT_YEARS = 5;
const PAGE_SIZE = 200;
const FAILURE_SAMPLE_LIMIT = 20;
const PROGRESS_INTERVAL = 200;
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;

export interface BackfillPricesOptions {
  years?: number;
  limit?: number;
}

export interface BackfillPricesResult {
  targetCount: number;
  skipped: number;
  succeeded: number;
  exhausted: number;
  failed: number;
  pagesFetched: number;
  written: number;
  blockedIntraday: number;
  failures: string[];
}

interface RateLimitRetryState {
  used: boolean;
}

const findOldestBar = (bars: DailyBar[]): DailyBar =>
  bars.reduce((oldest, bar) => {
    return bar.tradeDate < oldest.tradeDate ? bar : oldest;
  });

const toWriteRows = (
  ticker: UniverseTicker,
  bars: DailyBar[],
): DailyPriceWriteInput[] =>
  bars.map((bar) => ({
    tickerId: ticker.id,
    tradeDate: bar.tradeDate,
    open: bar.open?.toString(),
    close: bar.close.toString(),
    adjClose: bar.adjClose.toString(),
    volume: bar.volume,
  }));

@Injectable()
export class BackfillUniversePricesUsecase {
  private readonly logger = new Logger(BackfillUniversePricesUsecase.name);

  constructor(
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly repository: MarketDataPrismaRepository,
  ) {}

  async execute(
    options: BackfillPricesOptions = {},
  ): Promise<BackfillPricesResult> {
    const universe = await this.repository.findUniverseTickers();
    const targets =
      options.limit === undefined
        ? universe
        : universe.slice(0, Math.max(0, options.limit));
    const storedBarStats = await this.repository.findStoredBarStats();
    const targetStartDate = calculateBackfillStartDate(
      getTodayKstDate(),
      options.years ?? DEFAULT_YEARS,
    );
    const result: BackfillPricesResult = {
      targetCount: targets.length,
      skipped: 0,
      succeeded: 0,
      exhausted: 0,
      failed: 0,
      pagesFetched: 0,
      written: 0,
      blockedIntraday: 0,
      failures: [],
    };

    for (const [index, ticker] of targets.entries()) {
      const storedBarStat = storedBarStats.get(ticker.id);
      if (
        storedBarStat !== undefined &&
        storedBarStat.oldestTradeDate <= targetStartDate
      ) {
        result.skipped += 1;
        this.logProgress(index, targets.length, result);
        continue;
      }

      try {
        let cursor =
          storedBarStat === undefined
            ? undefined
            : buildBackfillCursor(
                new Date(`${storedBarStat.oldestTradeDate}T00:00:00.000Z`),
              );

        let shouldContinue = true;
        while (shouldContinue) {
          // 재시도 예산은 페이지마다 새로 준다. 종목 단위로 묶으면 앞 페이지에서 예산을
          // 쓴 종목이 뒤 페이지에서 한도에 걸리는 순간 그 종목 전체가 실패한다 —
          // 종목당 한 번만 요청하는 일일 수집과 달리 여기서는 여러 장을 이어 받는다.
          const retryState: RateLimitRetryState = { used: false };
          const bars = await this.fetchDailyBarsWithRateLimitRetry(
            ticker.tossSymbol,
            cursor,
            retryState,
          );
          result.pagesFetched += 1;
          if (bars.length === 0) {
            result.exhausted += 1;
            shouldContinue = false;
            continue;
          }

          const oldestBar = findOldestBar(bars);
          const oldestTradeDate = oldestBar.tradeDate
            .toISOString()
            .slice(0, 10);
          const cursorTradeDate = cursor?.slice(0, 10);
          if (
            cursorTradeDate !== undefined &&
            oldestTradeDate >= cursorTradeDate
          ) {
            result.exhausted += 1;
            shouldContinue = false;
            continue;
          }

          const writeResult = await this.repository.upsertDailyPrices(
            toWriteRows(ticker, bars),
          );
          result.written += writeResult.written;
          result.blockedIntraday += writeResult.blockedIntraday;
          if (oldestTradeDate <= targetStartDate) {
            result.succeeded += 1;
            shouldContinue = false;
            continue;
          }
          cursor = buildBackfillCursor(oldestBar.tradeDate);
        }
      } catch (error) {
        result.failed += 1;
        if (result.failures.length < FAILURE_SAMPLE_LIMIT) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.failures.push(`${ticker.code}: ${message}`);
        }
      }

      this.logProgress(index, targets.length, result);
    }

    return result;
  }

  private async fetchDailyBarsWithRateLimitRetry(
    symbol: string,
    cursor: string | undefined,
    retryState: RateLimitRetryState,
  ): Promise<DailyBar[]> {
    try {
      return await this.marketData.fetchDailyBars(symbol, PAGE_SIZE, {
        before: cursor,
      });
    } catch (error) {
      if (retryState.used || !(error instanceof MarketDataRateLimitError)) {
        throw error;
      }
      retryState.used = true;
      // CollectUniversePricesUsecase와 같은 종목당 1회·1초 대기 정책을 유지한다.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS);
      });
      return await this.marketData.fetchDailyBars(symbol, PAGE_SIZE, {
        before: cursor,
      });
    }
  }

  private logProgress(
    index: number,
    targetCount: number,
    result: BackfillPricesResult,
  ): void {
    const processed = index + 1;
    if (processed % PROGRESS_INTERVAL === 0) {
      this.logger.log(
        `유니버스 과거 시세 수집 진행 — ${processed}/${targetCount}, 성공 ${result.succeeded}, 소진 ${result.exhausted}, 실패 ${result.failed}`,
      );
    }
  }
}
