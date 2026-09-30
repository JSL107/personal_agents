import { Injectable, Logger } from '@nestjs/common';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { InvestorFlowRow } from '../../market-data/domain/investor-flow.type';
import {
  InvestorFlowBackfillTicker,
  MarketDataPrismaRepository,
} from '../../market-data/infrastructure/market-data.prisma.repository';
import { NaverInvestorFlowClient } from '../../market-data/infrastructure/naver/naver-investor-flow.client';
import { calculateBackfillStartDate } from '../domain/backfill-cursor';

const DEFAULT_YEARS = 5;
const FAILURE_SAMPLE_LIMIT = 20;
const PROGRESS_INTERVAL = 200;

export interface BackfillInvestorFlowOptions {
  years?: number;
  limit?: number;
}

export interface BackfillInvestorFlowResult {
  targetCount: number;
  skipped: number;
  succeeded: number;
  exhausted: number;
  stalled: number;
  failed: number;
  pagesFetched: number;
  written: number;
  failures: string[];
}

const dateTextOf = (date: Date): string => date.toISOString().slice(0, 10);

const precedingDate = (date: Date): string => {
  const preceding = new Date(date);
  preceding.setUTCDate(preceding.getUTCDate() - 1);
  return dateTextOf(preceding);
};

const rowsInTargetRange = (
  rows: InvestorFlowRow[],
  startDate: string,
): InvestorFlowRow[] =>
  rows.filter((row) => dateTextOf(row.tradeDate) >= startDate);

@Injectable()
export class BackfillInvestorFlowUsecase {
  private readonly logger = new Logger(BackfillInvestorFlowUsecase.name);

  constructor(
    private readonly client: NaverInvestorFlowClient,
    private readonly repository: MarketDataPrismaRepository,
  ) {}

  async execute(
    options: BackfillInvestorFlowOptions = {},
  ): Promise<BackfillInvestorFlowResult> {
    const universe = await this.repository.findInvestorFlowBackfillTickers();
    const targets =
      options.limit === undefined
        ? universe
        : universe.slice(0, Math.max(0, options.limit));
    const targetStartDate = calculateBackfillStartDate(
      getTodayKstDate(),
      options.years ?? DEFAULT_YEARS,
    );
    const priceTargets = await this.repository.findOldestPriceFlowTargets(
      new Date(`${targetStartDate}T00:00:00.000Z`),
    );
    const result: BackfillInvestorFlowResult = {
      targetCount: targets.length,
      skipped: 0,
      succeeded: 0,
      exhausted: 0,
      stalled: 0,
      failed: 0,
      pagesFetched: 0,
      written: 0,
      failures: [],
    };

    for (const [index, ticker] of targets.entries()) {
      const target = priceTargets.get(ticker.id);
      if (target === undefined || target.hasFlow) {
        result.skipped += 1;
        this.logProgress(index, targets.length, result);
        continue;
      }
      try {
        await this.backfillTicker(
          ticker,
          target.oldestTradeDate,
          targetStartDate,
          result,
        );
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

  private async backfillTicker(
    ticker: InvestorFlowBackfillTicker,
    oldestPriceDate: string,
    targetStartDate: string,
    result: BackfillInvestorFlowResult,
  ): Promise<void> {
    let cursor = getTodayKstDate();
    let shouldContinue = true;
    let hasPaged = false;
    while (shouldContinue) {
      const rows = await this.client.fetchRows(ticker.code, cursor);
      result.pagesFetched += 1;
      if (rows.length === 0) {
        result.exhausted += 1;
        shouldContinue = false;
        continue;
      }
      const oldestReturned = rows.reduce((oldest, row) =>
        row.tradeDate < oldest.tradeDate ? row : oldest,
      );
      const oldestReturnedDate = dateTextOf(oldestReturned.tradeDate);
      if (hasPaged && oldestReturnedDate >= cursor) {
        result.stalled += 1;
        shouldContinue = false;
        continue;
      }
      hasPaged = true;
      result.written += await this.repository.updateInvestorFlow(
        ticker.id,
        rowsInTargetRange(rows, targetStartDate),
      );
      if (
        oldestReturnedDate <= oldestPriceDate ||
        oldestReturnedDate <= targetStartDate
      ) {
        result.succeeded += 1;
        shouldContinue = false;
        continue;
      }
      cursor = precedingDate(oldestReturned.tradeDate);
    }
  }

  private logProgress(
    index: number,
    targetCount: number,
    result: BackfillInvestorFlowResult,
  ): void {
    const processed = index + 1;
    if (processed % PROGRESS_INTERVAL === 0) {
      this.logger.log(
        `유니버스 과거 수급 수집 진행 — ${processed}/${targetCount}, 성공 ${result.succeeded}, 건너뜀 ${result.skipped}, 소진 ${result.exhausted}, 미진전 ${result.stalled}, 실패 ${result.failed}`,
      );
    }
  }
}
