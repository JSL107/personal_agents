import { Injectable } from '@nestjs/common';

import { calculateIndicators } from '../../market-data/domain/stock-indicator';
import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import {
  ScreenCandidate,
  ScreenedStock,
  SCREENER_RULE_VERSION,
  screenStocks,
  ScreenStrategy,
} from '../domain/screener-rule';

const TICKER_READ_CHUNK_SIZE = 200;
const INDICATOR_BAR_LIMIT = 200;
const DEFAULT_SCREEN_LIMIT = 20;

export interface ScreenUniverseOptions {
  strategy: ScreenStrategy;
  limit?: number;
}

export interface ScreenUniverseResult {
  strategy: ScreenStrategy;
  ruleVersion: number;
  universeCount: number;
  evaluatedCount: number;
  passedCount: number;
  stocks: ScreenedStock[];
  asOf: string | null;
}

@Injectable()
export class ScreenUniverseUsecase {
  constructor(private readonly repository: MarketDataRepository) {}

  async execute(options: ScreenUniverseOptions): Promise<ScreenUniverseResult> {
    const universe = await this.repository.findUniverseTickers();
    const candidates: ScreenCandidate[] = [];
    let latestTradeDate: Date | null = null;

    for (
      let offset = 0;
      offset < universe.length;
      offset += TICKER_READ_CHUNK_SIZE
    ) {
      const tickerChunk = universe.slice(
        offset,
        offset + TICKER_READ_CHUNK_SIZE,
      );
      const barsByTicker = await this.repository.findBarsForTickers(
        tickerChunk.map((ticker) => ticker.id),
        INDICATOR_BAR_LIMIT,
      );
      for (const ticker of tickerChunk) {
        const bars = barsByTicker.get(ticker.id) ?? [];
        const indicators = calculateIndicators(bars);
        if (indicators === null) {
          continue;
        }
        const tickerLatestTradeDate = bars[bars.length - 1].tradeDate;
        if (
          latestTradeDate === null ||
          tickerLatestTradeDate > latestTradeDate
        ) {
          latestTradeDate = tickerLatestTradeDate;
        }
        candidates.push({
          tickerId: ticker.id,
          code: ticker.code,
          name: ticker.name,
          krxMarket: ticker.krxMarket,
          indicators,
        });
      }
    }

    // 점수는 limit 밖 통과 후보까지 포함한 전체 순위로 계산해야 실행마다 의미가 같다.
    const passed = screenStocks(
      candidates,
      options.strategy,
      candidates.length,
    );
    const limit = options.limit ?? DEFAULT_SCREEN_LIMIT;
    return {
      strategy: options.strategy,
      ruleVersion: SCREENER_RULE_VERSION,
      universeCount: universe.length,
      evaluatedCount: candidates.length,
      passedCount: passed.length,
      stocks: passed.slice(0, Math.max(0, limit)),
      asOf:
        latestTradeDate === null
          ? null
          : latestTradeDate.toISOString().slice(0, 10),
    };
  }
}
