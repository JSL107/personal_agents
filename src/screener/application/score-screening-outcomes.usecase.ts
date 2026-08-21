import { Injectable } from '@nestjs/common';

import {
  scoreScreeningItem,
  SCREENING_OUTCOME_HORIZONS,
  ScreeningOutcomeBar,
  ScreeningOutcomeSkipReason,
} from '../domain/screening-outcome';
import {
  SaveScreeningItemOutcomeInput,
  ScreeningHistoryPrismaRepository,
  ScreeningOutcomeBarRow,
} from '../infrastructure/screening-history.prisma.repository';

export type ScreeningOutcomeSkipCounts = Record<
  ScreeningOutcomeSkipReason,
  number
>;

export interface ScreeningOutcomeHorizonSummary {
  horizonDays: number;
  // 이 지평으로 아직 재지 않은 항목 수. 아래 두 수의 합이다.
  attemptedCount: number;
  scoredCount: number;
  skipped: ScreeningOutcomeSkipCounts;
}

export interface ScoreScreeningOutcomesResult {
  horizons: ScreeningOutcomeHorizonSummary[];
  totalScoredCount: number;
}

const emptySkipCounts = (): ScreeningOutcomeSkipCounts => ({
  NOT_DUE: 0,
  ENTRY_OPEN_MISSING: 0,
  ENTRY_PRICE_NOT_POSITIVE: 0,
});

const toBarsByTicker = (
  rows: ScreeningOutcomeBarRow[],
): Map<number, ScreeningOutcomeBar[]> => {
  const barsByTicker = new Map<number, ScreeningOutcomeBar[]>();
  for (const row of rows) {
    const found = barsByTicker.get(row.tickerId) ?? [];
    found.push({
      tradeDate: row.tradeDate,
      open: row.open,
      close: row.close,
    });
    barsByTicker.set(row.tickerId, found);
  }
  return barsByTicker;
};

// 회차에 실린 종목의 사후 성적을 남긴다. 산 종목과 안 산 종목을 같은 잣대로 재 두어야
// "고른 것이 나았나" 를 물을 수 있다 — 채점은 구분 없이 전부 하고, 대조는 읽는 쪽에서
// paper_order 와 조인해 가른다.
@Injectable()
export class ScoreScreeningOutcomesUsecase {
  constructor(private readonly repository: ScreeningHistoryPrismaRepository) {}

  async execute(): Promise<ScoreScreeningOutcomesResult> {
    const horizons: ScreeningOutcomeHorizonSummary[] = [];
    let totalScoredCount = 0;

    for (const horizonDays of SCREENING_OUTCOME_HORIZONS) {
      const summary = await this.scoreHorizon(horizonDays);
      horizons.push(summary);
      totalScoredCount += summary.scoredCount;
    }

    return { horizons, totalScoredCount };
  }

  private async scoreHorizon(
    horizonDays: number,
  ): Promise<ScreeningOutcomeHorizonSummary> {
    const runs = await this.repository.findUnscoredRuns(horizonDays);
    const skipped = emptySkipCounts();
    let attemptedCount = 0;
    let scoredCount = 0;

    for (const run of runs) {
      attemptedCount += run.items.length;
      const barsByTicker = toBarsByTicker(
        await this.repository.findBarsAfter(
          run.items.map((item) => item.tickerId),
          run.asOf,
        ),
      );
      const rows: SaveScreeningItemOutcomeInput[] = [];
      for (const item of run.items) {
        const result = scoreScreeningItem({
          horizonDays,
          barsAfterAsOf: barsByTicker.get(item.tickerId) ?? [],
        });
        if (result.kind === 'SKIPPED') {
          skipped[result.reason] += 1;
          continue;
        }
        rows.push({ itemId: item.itemId, ...result.outcome });
      }
      scoredCount += await this.repository.saveScreeningItemOutcomes(rows);
    }

    return { horizonDays, attemptedCount, scoredCount, skipped };
  }
}
