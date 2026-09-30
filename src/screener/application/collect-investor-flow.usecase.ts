import { Injectable, Logger } from '@nestjs/common';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';
import { NaverInvestorFlowClient } from '../../market-data/infrastructure/naver/naver-investor-flow.client';

const FAILURE_SAMPLE_LIMIT = 20;
const PROGRESS_INTERVAL = 200;

export interface CollectInvestorFlowOptions {
  limit?: number;
}

export interface CollectInvestorFlowResult {
  targetCount: number;
  succeeded: number;
  failed: number;
  written: number;
  failures: string[];
}

@Injectable()
export class CollectInvestorFlowUsecase {
  private readonly logger = new Logger(CollectInvestorFlowUsecase.name);

  constructor(
    private readonly client: NaverInvestorFlowClient,
    private readonly repository: MarketDataPrismaRepository,
  ) {}

  async execute(
    options: CollectInvestorFlowOptions = {},
  ): Promise<CollectInvestorFlowResult> {
    const universe = await this.repository.findUniverseTickers();
    const targets =
      options.limit === undefined
        ? universe
        : universe.slice(0, Math.max(0, options.limit));
    const result: CollectInvestorFlowResult = {
      targetCount: targets.length,
      succeeded: 0,
      failed: 0,
      written: 0,
      failures: [],
    };
    const bizdate = getTodayKstDate();

    for (const [index, ticker] of targets.entries()) {
      try {
        const rows = await this.client.fetchRows(ticker.code, bizdate);
        result.written += await this.repository.updateInvestorFlow(
          ticker.id,
          rows,
        );
        result.succeeded += 1;
      } catch (error) {
        result.failed += 1;
        if (result.failures.length < FAILURE_SAMPLE_LIMIT) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.failures.push(`${ticker.code}: ${message}`);
        }
      }
      if ((index + 1) % PROGRESS_INTERVAL === 0) {
        this.logger.log(
          `유니버스 수급 수집 진행 — ${index + 1}/${targets.length}, 성공 ${result.succeeded}, 실패 ${result.failed}`,
        );
      }
    }
    return result;
  }
}
