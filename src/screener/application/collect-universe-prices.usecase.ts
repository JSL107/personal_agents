import { Inject, Injectable, Logger } from '@nestjs/common';

import { DailyBar } from '../../market-data/domain/market-data.type';
import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import {
  DailyPriceWriteInput,
  DailyPriceWriteResult,
  MarketDataPrismaRepository,
  UniverseTicker,
} from '../../market-data/infrastructure/market-data.prisma.repository';

const DEFAULT_INCREMENTAL_DAYS = 5;
const DEFAULT_INITIAL_DAYS = 200;
const FAILURE_SAMPLE_LIMIT = 20;
const PROGRESS_INTERVAL = 200;
const RATE_LIMIT_RETRY_DELAY_MS = 1_000;

export interface CollectPricesOptions {
  days?: number;
  limit?: number;
}

export interface CollectPricesResult {
  targetCount: number;
  succeeded: number;
  failed: number;
  written: number;
  blockedIntraday: number;
  readjusted: number;
  retried: number;
  failures: string[];
}

interface RateLimitRetryState {
  used: boolean;
  succeeded: boolean;
}

const toWriteRows = (
  ticker: UniverseTicker,
  bars: DailyBar[],
): DailyPriceWriteInput[] =>
  bars.map((bar) => ({
    tickerId: ticker.id,
    tradeDate: bar.tradeDate,
    open: bar.open?.toString(),
    high: bar.high?.toString(),
    low: bar.low?.toString(),
    close: bar.close.toString(),
    adjClose: bar.adjClose.toString(),
    volume: bar.volume,
  }));

const hasStoredCloseChange = (
  bars: DailyBar[],
  storedCloses: Map<string, string>,
): boolean =>
  bars.some((bar) => {
    const key = bar.tradeDate.toISOString().slice(0, 10);
    const stored = storedCloses.get(key);
    return stored !== undefined && stored !== bar.close.toString();
  });

@Injectable()
export class CollectUniversePricesUsecase {
  private readonly logger = new Logger(CollectUniversePricesUsecase.name);

  constructor(
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly repository: MarketDataPrismaRepository,
  ) {}

  async execute(
    options: CollectPricesOptions = {},
  ): Promise<CollectPricesResult> {
    const universe = await this.repository.findUniverseTickers();
    const targets =
      options.limit === undefined
        ? universe
        : universe.slice(0, Math.max(0, options.limit));
    const storedBarStats = await this.repository.findStoredBarStats();
    const result: CollectPricesResult = {
      targetCount: targets.length,
      succeeded: 0,
      failed: 0,
      written: 0,
      blockedIntraday: 0,
      readjusted: 0,
      retried: 0,
      failures: [],
    };

    for (const [index, ticker] of targets.entries()) {
      try {
        const retryState: RateLimitRetryState = {
          used: false,
          succeeded: false,
        };
        const barCount = storedBarStats.get(ticker.id)?.barCount ?? 0;
        const hasCompleteHistory = barCount >= DEFAULT_INITIAL_DAYS;
        const days =
          options.days ??
          (hasCompleteHistory
            ? DEFAULT_INCREMENTAL_DAYS
            : DEFAULT_INITIAL_DAYS);
        const bars = await this.fetchDailyBarsWithRateLimitRetry(
          ticker.tossSymbol,
          days,
          retryState,
        );
        let writeResult: DailyPriceWriteResult;
        if (barCount === 0) {
          writeResult = await this.repository.insertDailyPrices(
            toWriteRows(ticker, bars),
          );
        } else if (!hasCompleteHistory) {
          // 일부 이력은 과거 조정가일 수 있어 빈 행만 채우지 않고 전체 응답으로 덮는다.
          writeResult = await this.repository.upsertDailyPrices(
            toWriteRows(ticker, bars),
          );
        } else {
          const storedCloses = await this.repository.findStoredCloses(
            ticker.id,
            bars.map((bar) => bar.tradeDate),
          );
          if (hasStoredCloseChange(bars, storedCloses)) {
            const refreshedBars = await this.fetchDailyBarsWithRateLimitRetry(
              ticker.tossSymbol,
              DEFAULT_INITIAL_DAYS,
              retryState,
            );
            writeResult = await this.repository.upsertDailyPrices(
              toWriteRows(ticker, refreshedBars),
            );
            result.readjusted += 1;
            this.logger.log(
              `조정가 소급 재작성 감지 — ${ticker.code} ${refreshedBars.length}봉 재수집`,
            );
          } else {
            writeResult = await this.repository.upsertDailyPrices(
              toWriteRows(ticker, bars),
            );
          }
        }
        result.written += writeResult.written;
        result.blockedIntraday += writeResult.blockedIntraday;
        result.succeeded += 1;
        if (retryState.succeeded) {
          result.retried += 1;
        }
      } catch (error) {
        result.failed += 1;
        if (result.failures.length < FAILURE_SAMPLE_LIMIT) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.failures.push(`${ticker.code}: ${message}`);
        }
      }

      const processed = index + 1;
      if (processed % PROGRESS_INTERVAL === 0) {
        this.logger.log(
          `유니버스 시세 수집 진행 — ${processed}/${targets.length}, 성공 ${result.succeeded}, 실패 ${result.failed}`,
        );
      }
    }

    return result;
  }

  private async fetchDailyBarsWithRateLimitRetry(
    symbol: string,
    days: number,
    retryState: RateLimitRetryState,
  ): Promise<DailyBar[]> {
    try {
      return await this.marketData.fetchDailyBars(symbol, days);
    } catch (error) {
      if (retryState.used || !(error instanceof MarketDataRateLimitError)) {
        throw error;
      }
      retryState.used = true;
      // adapter가 공급자별 상태를 같은 도메인 오류로 정규화하므로 어느 시세 공급자든 정책이 같다.
      // 재시도는 종목당 한 번뿐이라 곡선 없이 토스 한도 회복 시간을 고정으로 확보한다.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS);
      });
      const bars = await this.marketData.fetchDailyBars(symbol, days);
      retryState.succeeded = true;
      return bars;
    }
  }
}
