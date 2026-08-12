import { Injectable } from '@nestjs/common';

import { isIntradayCapture } from '../../market-data/domain/intraday-guard';
import {
  BenchmarkCloseWriteInput,
  BenchmarkRepository,
} from '../../market-data/infrastructure/benchmark.repository';
import { TossMarketIndicatorClient } from '../../market-data/infrastructure/toss/toss-market-indicator.client';

const BENCHMARK_SYMBOL = 'KOSPI';
const DEFAULT_INCREMENTAL_DAYS = 5;
const DEFAULT_INITIAL_DAYS = 200;

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
  constructor(
    private readonly marketIndicator: TossMarketIndicatorClient,
    private readonly repository: BenchmarkRepository,
  ) {}

  async execute(
    options: CollectBenchmarkOptions = {},
  ): Promise<CollectBenchmarkResult> {
    const latestTradeDate =
      await this.repository.findLatestTradeDate(BENCHMARK_SYMBOL);
    const days =
      options.days ??
      (latestTradeDate === null
        ? DEFAULT_INITIAL_DAYS
        : DEFAULT_INCREMENTAL_DAYS);
    const bars = await this.marketIndicator.fetchDailyCloses(
      BENCHMARK_SYMBOL,
      days,
    );
    const now = new Date();
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
