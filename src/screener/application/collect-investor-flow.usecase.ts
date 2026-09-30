import { Injectable, Logger } from '@nestjs/common';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';
import { NaverInvestorFlowClient } from '../../market-data/infrastructure/naver/naver-investor-flow.client';

const FAILURE_SAMPLE_LIMIT = 20;
const PROGRESS_INTERVAL = 200;
// 연속으로 이만큼 실패하면 종목 사정이 아니라 공급자 전면 장애로 보고 나머지를 부르지 않는다.
// 네이버가 응답하지 않으면 종목마다 10초 timeout 을 직렬로 기다려, 약 2,600종목이면 스윕이
// 7시간 가까이 붙잡혀 19:30 추천 전에 끝나지 않는다. 수급은 부가 데이터라 다음 날 60일 재수집이
// 메우므로, 끊고 넘어가는 편이 기다리는 것보다 낫다.
export const MAXIMUM_CONSECUTIVE_FAILURES = 20;

export interface CollectInvestorFlowOptions {
  limit?: number;
}

export interface CollectInvestorFlowResult {
  targetCount: number;
  succeeded: number;
  failed: number;
  written: number;
  failures: string[];
  // 연속 실패 상한에 닿아 부르지 않은 종목 수. 0 이 아니면 공급자 장애다.
  abortedCount: number;
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
      abortedCount: 0,
    };
    let consecutiveFailures = 0;
    const bizdate = getTodayKstDate();

    for (const [index, ticker] of targets.entries()) {
      if (consecutiveFailures >= MAXIMUM_CONSECUTIVE_FAILURES) {
        result.abortedCount = targets.length - index;
        this.logger.warn(
          `수급 공급자 연속 실패 ${consecutiveFailures}회 — 남은 ${result.abortedCount}종목을 건너뛴다`,
        );
        break;
      }
      try {
        const rows = await this.client.fetchRows(ticker.code, bizdate);
        result.written += await this.repository.updateInvestorFlow(
          ticker.id,
          rows,
        );
        result.succeeded += 1;
        consecutiveFailures = 0;
      } catch (error) {
        result.failed += 1;
        consecutiveFailures += 1;
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
