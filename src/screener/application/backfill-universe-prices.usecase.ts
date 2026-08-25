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
  // 이미 목표만큼 받아 둔 종목도 다시 받는다. 배당·분할로 `adjusted=true` 과거 가격이
  // 소급 변경되면 일일 수집이 최근 200봉만 다시 쓰므로, 그보다 오래된 백필분은 옛 조정
  // 기준으로 남아 한 시계열에 기준이 둘 공존한다. 이 손잡이가 그 구간을 갱신하는 수단이다.
  recheck?: boolean;
}

export interface BackfillPricesResult {
  targetCount: number;
  skipped: number;
  succeeded: number;
  // 공급자가 더 줄 게 없어 끝난 종목. 상장 이력이 목표보다 짧으면 정상적으로 여기 들어온다.
  exhausted: number;
  // 커서가 진전하지 않아 끊은 종목. 같은 페이지가 반복된다는 뜻이므로 공급자 이상 신호이며,
  // 목표에 도달하지 못한 채 끝난 것이라 `exhausted` 와 같은 칸에 담으면 장애가 묻힌다.
  stalled: number;
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
      stalled: 0,
      failed: 0,
      pagesFetched: 0,
      written: 0,
      blockedIntraday: 0,
      failures: [],
    };

    const shouldRecheck = options.recheck === true;
    for (const [index, ticker] of targets.entries()) {
      const storedBarStat = storedBarStats.get(ticker.id);
      if (
        !shouldRecheck &&
        storedBarStat !== undefined &&
        storedBarStat.oldestTradeDate <= targetStartDate
      ) {
        result.skipped += 1;
        this.logProgress(index, targets.length, result);
        continue;
      }

      try {
        // recheck 는 최신부터 다시 받아야 뜻이 선다. 저장된 최古 봉부터 이어 받으면
        // 이미 있는 구간은 그대로 남아, 조정가가 바뀐 자리를 정확히 비껴간다.
        let cursor =
          shouldRecheck || storedBarStat === undefined
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
            // 토스는 커서 날짜의 봉을 응답에 포함한다. 상장일까지 다 받은 종목은 그 봉
            // 하나만 돌아오므로 빈 응답이 아니고 커서도 움직이지 않는다 — 이건 더 줄 게
            // 없다는 뜻이지 이상이 아니다. 상장 5년 미만 종목이 전부 이 경로로 끝난다.
            // 반면 여러 봉이 통째로 다시 오면 공급자가 커서를 무시한 것이라 이상 신호다.
            if (bars.length <= 1) {
              result.exhausted += 1;
            } else {
              result.stalled += 1;
            }
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
      // 모든 종료 사유를 싣는다. 일부만 찍으면 처리 수와 합이 맞지 않아, 어디로 샜는지
      // 로그만 보고는 알 수 없다(실제로 stalled 를 빠뜨려 그 상태를 한 번 만들었다).
      this.logger.log(
        `유니버스 과거 시세 수집 진행 — ${processed}/${targetCount}, 성공 ${result.succeeded}, 건너뜀 ${result.skipped}, 소진 ${result.exhausted}, 미진전 ${result.stalled}, 실패 ${result.failed}`,
      );
    }
  }
}
