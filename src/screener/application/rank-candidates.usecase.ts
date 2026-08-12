import { Injectable } from '@nestjs/common';

import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import {
  selectLongTermCandidates,
  selectSwingCandidates,
} from '../domain/candidate-selection';
import { calculateIndicator } from '../domain/indicator';
import { StockIndicator } from '../domain/indicator.type';

const DEFAULT_CANDIDATE_LIMIT = 25;
// 토스가 한 번에 주는 상한과 같다. 더 요청해도 저장된 것이 200봉이다.
const SERIES_BAR_LIMIT = 200;

export interface RankCandidatesOptions {
  limit?: number;
}

export interface RankCandidatesResult {
  universeCount: number;
  evaluatedCount: number;
  // 봉이 모자라 평가하지 못한 종목 수. 조용히 사라지면 전종목을 본 것으로 오해한다.
  skippedCount: number;
  longTerm: StockIndicator[];
  swing: StockIndicator[];
}

@Injectable()
export class RankCandidatesUsecase {
  constructor(private readonly repository: MarketDataRepository) {}

  async execute(
    options: RankCandidatesOptions = {},
  ): Promise<RankCandidatesResult> {
    const limit = options.limit ?? DEFAULT_CANDIDATE_LIMIT;
    const universe = await this.repository.findUniverseTickers();
    const series = await this.repository.findDailySeries(
      universe.map((ticker) => ticker.id),
      SERIES_BAR_LIMIT,
    );
    const indicators: StockIndicator[] = [];
    for (const ticker of universe) {
      const values = calculateIndicator(series.get(ticker.id) ?? []);
      if (values === null) {
        continue;
      }
      indicators.push({
        ...values,
        tickerId: ticker.id,
        code: ticker.code,
        name: ticker.name,
        krxMarket: ticker.krxMarket,
      });
    }

    return {
      universeCount: universe.length,
      evaluatedCount: indicators.length,
      skippedCount: universe.length - indicators.length,
      longTerm: selectLongTermCandidates(indicators, limit),
      swing: selectSwingCandidates(indicators, limit),
    };
  }
}
