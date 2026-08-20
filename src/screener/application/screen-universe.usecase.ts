import { Injectable } from '@nestjs/common';

import {
  calculateIndicators,
  StockIndicators,
} from '../../market-data/domain/stock-indicator';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';
import {
  ScreenCandidate,
  ScreenedStock,
  SCREENER_RULE_VERSION,
  screenStocks,
  ScreenStrategy,
} from '../domain/screener-rule';
import { ScreeningHistoryPrismaRepository } from '../infrastructure/screening-history.prisma.repository';

const TICKER_READ_CHUNK_SIZE = 200;
const INDICATOR_BAR_LIMIT = 200;
const DEFAULT_SCREEN_LIMIT = 20;

export interface ScreenUniverseOptions {
  strategy: ScreenStrategy;
  limit?: number;
  includeTickerIds?: number[];
  // 이 회차를 원장에 남길지. 기본은 남기지 않는다 — 상한을 바꿔가며 확인하는 임의 실행이
  // 같은 기준일 회차를 덮어쓰면 원장이 "그날 무엇을 보여줬나" 대신 마지막 실행 흔적이 된다.
  record?: boolean;
}

export interface IncludedStockIndicators {
  tickerId: number;
  code: string;
  name: string;
  indicators: StockIndicators;
}

export interface ScreenUniverseResult {
  strategy: ScreenStrategy;
  ruleVersion: number;
  universeCount: number;
  evaluatedCount: number;
  staleCount: number;
  passedCount: number;
  stocks: ScreenedStock[];
  includedIndicators: IncludedStockIndicators[];
  asOf: string | null;
  // 원장에 남은 회차 id. null 이면 남기지 않은 실행이다 — record 를 켜지 않았거나
  // 기준일이 없어(시세 0건) 남길 회차 자체가 없다.
  recordedRunId: number | null;
}

interface DatedScreenCandidate {
  candidate: ScreenCandidate;
  latestTradeDate: Date;
}

@Injectable()
export class ScreenUniverseUsecase {
  constructor(
    private readonly repository: MarketDataPrismaRepository,
    private readonly historyRepository: ScreeningHistoryPrismaRepository,
  ) {}

  async execute(options: ScreenUniverseOptions): Promise<ScreenUniverseResult> {
    const universe = await this.repository.findUniverseTickers();
    const datedCandidates: DatedScreenCandidate[] = [];
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
        datedCandidates.push({
          latestTradeDate: tickerLatestTradeDate,
          candidate: {
            tickerId: ticker.id,
            code: ticker.code,
            name: ticker.name,
            krxMarket: ticker.krxMarket,
            indicators,
          },
        });
      }
    }

    // 횡단면 순위는 같은 종가 기준일끼리만 비교해야 지연된 가격이 오늘 후보로 섞이지 않는다.
    const asOf = latestTradeDate?.toISOString().slice(0, 10) ?? null;
    const candidates =
      asOf === null
        ? []
        : datedCandidates
            .filter(
              (item) =>
                item.latestTradeDate.toISOString().slice(0, 10) === asOf,
            )
            .map((item) => item.candidate);
    const staleCount = datedCandidates.length - candidates.length;
    // 점수는 limit 밖 통과 후보까지 포함한 전체 순위로 계산해야 실행마다 의미가 같다.
    const passed = screenStocks(
      candidates,
      options.strategy,
      candidates.length,
    );
    const includedTickerIds = new Set(options.includeTickerIds ?? []);
    const includedIndicators = candidates
      .filter((candidate) => includedTickerIds.has(candidate.tickerId))
      .map((candidate) => ({
        tickerId: candidate.tickerId,
        code: candidate.code,
        name: candidate.name,
        indicators: candidate.indicators,
      }));
    const limit = options.limit ?? DEFAULT_SCREEN_LIMIT;
    const stocks = passed.slice(0, Math.max(0, limit));
    const result: ScreenUniverseResult = {
      strategy: options.strategy,
      ruleVersion: SCREENER_RULE_VERSION,
      universeCount: universe.length,
      evaluatedCount: datedCandidates.length,
      staleCount,
      passedCount: passed.length,
      stocks,
      includedIndicators,
      asOf,
      recordedRunId: null,
    };
    if (options.record !== true || asOf === null) {
      return result;
    }
    // 남기는 것은 통과 전체가 아니라 limit 안에 든 목록이다 — 추천 프롬프트에 실리는 범위와
    // 같아야 "보여줬는데 안 샀다" 를 뒤에서 가릴 수 있다. 전체 통과 수는 passedCount 로 간다.
    const saved = await this.historyRepository.saveScreeningRun({
      strategy: options.strategy,
      asOf: new Date(`${asOf}T00:00:00.000Z`),
      ruleVersion: SCREENER_RULE_VERSION,
      universeCount: universe.length,
      evaluatedCount: datedCandidates.length,
      staleCount,
      passedCount: passed.length,
      items: stocks.map((stock, index) => ({
        tickerId: stock.tickerId,
        rank: index + 1,
        score: stock.score,
        indicatorSnapshot: stock.indicators,
      })),
    });
    return { ...result, recordedRunId: saved.runId };
  }
}
