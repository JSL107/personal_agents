import { Inject, Injectable, Logger } from '@nestjs/common';

import { DailyBar } from '../../market-data/domain/market-data.type';
import { MarketDataRateLimitError } from '../../market-data/domain/market-data-rate-limit.error';
import { MarketDataSymbolNotFoundError } from '../../market-data/domain/market-data-symbol-not-found.error';
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
const DAY_MS = 24 * 60 * 60 * 1_000;
// 공급자가 심볼을 모른다(404)고 답하고 마지막 봉도 이 일수를 넘겨 멈춘 종목은 장애가 아니라
// 공급 중단으로 센다. 폐지 판정은 KRX 상장법인 목록 차분과 KIND 폐지 이력이 내리는데 둘 다
// 놓치는 종목이 있다 — 094800(맵스리얼티)은 상장·거래 중이면서 2026-08-19 부터 토스가 404 를
// 주고, 집합투자기구라 KIND 폐지 목록에도 오르지 않아 유니버스에 활성으로 영구히 남는다.
// 두 조건을 함께 보는 이유: 404 만 보면 방금 사라진 종목까지 조용해지고, 봉 정지만 보면
// 한도 초과·타임아웃 같은 진짜 장애가 오래된 종목에서 묻힌다.
// 조회 자체는 계속한다. 공급이 돌아오면 그 회차부터 저절로 성공으로 집계된다.
const DORMANT_AFTER_DAYS = 14;
// 공급 중단으로 넘길 수 있는 상한. 이 선을 넘으면 종목별 사정이 아니라 공급자 전면 장애이고,
// 그때도 조용히 넘기면 스윕이 실패 0 으로 보고돼 장애가 며칠 묻힌다.
// 비율과 건수를 함께 보는 이유: 비율만 쓰면 `--limit` 으로 몇 종목만 돌릴 때 1건이 곧 장애가
// 되고, 건수만 쓰면 유니버스가 커질수록 상한이 헐거워진다.
// `markDelistedExcept` 가 안전 하한을 크기와 비율 두 개로 두는 것과 같은 자리다.
const DORMANT_MAX_RATIO = 0.01;
const DORMANT_OUTAGE_MINIMUM = 20;

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
  // 시세 공급이 끊긴 종목 코드. 실패와 섞으면 매 회차 같은 종목이 알림을 채운다.
  dormant: string[];
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

const isDormant = (latestTradeDate: string, asOf: Date): boolean =>
  asOf.getTime() - new Date(`${latestTradeDate}T00:00:00.000Z`).getTime() >
  DORMANT_AFTER_DAYS * DAY_MS;

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
      dormant: [],
    };
    const asOf = new Date();

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
        const latestTradeDate = storedBarStats.get(ticker.id)?.latestTradeDate;
        if (
          error instanceof MarketDataSymbolNotFoundError &&
          latestTradeDate !== undefined &&
          isDormant(latestTradeDate, asOf)
        ) {
          // 봉이 한 개도 없는 종목은 여기 걸리지 않는다 — 신규 상장의 첫 수집 실패는 봐야 한다.
          result.dormant.push(ticker.code);
        } else {
          result.failed += 1;
          if (result.failures.length < FAILURE_SAMPLE_LIMIT) {
            const message =
              error instanceof Error ? error.message : String(error);
            result.failures.push(`${ticker.code}: ${message}`);
          }
        }
      }

      const processed = index + 1;
      if (processed % PROGRESS_INTERVAL === 0) {
        this.logger.log(
          `유니버스 시세 수집 진행 — ${processed}/${targets.length}, 성공 ${result.succeeded}, 실패 ${result.failed}`,
        );
      }
    }

    if (
      result.dormant.length >= DORMANT_OUTAGE_MINIMUM &&
      result.dormant.length > targets.length * DORMANT_MAX_RATIO
    ) {
      this.logger.warn(
        `시세 공급 중단 ${result.dormant.length}/${targets.length}종목 — 공급자 장애로 보고 실패로 되돌린다`,
      );
      for (const code of result.dormant) {
        result.failed += 1;
        if (result.failures.length < FAILURE_SAMPLE_LIMIT) {
          result.failures.push(`${code}: 시세 공급 없음(HTTP 404)`);
        }
      }
      result.dormant = [];
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
