import { Injectable } from '@nestjs/common';

import { DailyBar } from '../../domain/market-data.type';
import { MarketDataRateLimitError } from '../../domain/market-data-rate-limit.error';
import {
  FetchDailyBarsOptions,
  MarketDataPort,
} from '../../domain/port/market-data.port';
import { YahooFinanceMarketDataClient } from '../yahoo-finance.market-data.client';
import { TossApiClient, TossApiHttpError } from './toss-api.client';
import { mapTossCandlesResponse } from './toss-market-data.mapper';

// 실측(2026-08-06) — MARKET_DATA_CHART 는 5회/초다. 무간격 연속 호출은 6번째부터
// HTTP 429 로 끊긴다. 보유 종목을 루프로 돌리면 반드시 걸리므로 간격을 강제한다.
const MINIMUM_REQUEST_INTERVAL_MS = 220;
// `/candles` 의 count 상한. 초과하면 서버가 HTTP 400 으로 거부한다.
const MAXIMUM_CANDLE_COUNT = 200;

@Injectable()
export class TossMarketDataClient implements MarketDataPort {
  private lastRequestAt: number | null = null;

  constructor(
    private readonly tossApi: TossApiClient,
    private readonly yahooMarketData: YahooFinanceMarketDataClient,
  ) {}

  async fetchDailyBars(
    symbol: string,
    days: number,
    options?: FetchDailyBarsOptions,
  ): Promise<DailyBar[]> {
    if (days <= 0) {
      return [];
    }

    await this.waitForRequestInterval();
    const count = Math.min(days, MAXIMUM_CANDLE_COUNT);
    // 심볼은 DB(`ticker.toss_symbol`) 에서 온 값이라 쿼리에 그대로 이어붙이지 않는다.
    //
    // adjusted 는 토스 기본값도 true 지만 명시한다. 판정이 이 값에 직접 의존하는데(전일 대비는
    // 연속 두 봉의 비율이라 조정 계열이 아니면 배당락이 가짜 급락으로 잡힌다), 문서화된 기본값에
    // 기대면 토스가 그것을 바꾸는 날 모든 가격이 조용히 달라진다.
    //
    // 실측(2026-08-06 직접 호출): 월배당 종목 441640 은 adjusted true/false 가 200봉 중 183봉에서
    // 갈리고, 무배당 종목 114800(KODEX 인버스)은 0봉이 갈린다 — 현금배당까지 조정된다는 뜻이다.
    // 모의투자 장부는 반대로 미조정 실제 가격이 필요해 `options.adjusted=false`로 호출한다(스펙 §5-(1)).
    // 기본값 `true`는 기존 감시 호출자의 동작을 보존한다.
    const adjusted = options?.adjusted ?? true;
    const query = new URLSearchParams({
      symbol,
      interval: '1d',
      count: String(count),
      adjusted: String(adjusted),
    });
    let response: unknown;
    try {
      response = await this.tossApi.requestJson(
        '일봉 조회',
        `/api/v1/candles?${query.toString()}`,
      );
    } catch (error) {
      if (error instanceof TossApiHttpError && error.status === 429) {
        // 공급자 HTTP 표현을 감춰 application의 재시도 정책이 adapter 교체에도 유지되게 한다.
        throw new MarketDataRateLimitError();
      }
      throw error;
    }
    const bars = mapTossCandlesResponse(response);
    if (!bars) {
      throw new Error(
        `토스증권 일봉 응답 형식이 올바르지 않습니다 — ${symbol}`,
      );
    }
    return bars.slice(-days);
  }

  async fetchUsdKrwRate(): Promise<string | null> {
    // 토스증권에는 실측된 환율 API가 없어 환율 조회만 Yahoo에 위임한다.
    return await this.yahooMarketData.fetchUsdKrwRate();
  }

  // ponytail: 고정 간격이라 동시 호출은 경쟁할 수 있다. 현재 종목 조회는 순차이고 KR/US task도
  // 다른 시각에 실행된다. 종목 수 증가나 병렬화 시 엔드포인트별 token bucket으로 교체한다.
  private async waitForRequestInterval(): Promise<void> {
    const now = Date.now();
    if (this.lastRequestAt !== null) {
      const elapsed = now - this.lastRequestAt;
      const waitMs = MINIMUM_REQUEST_INTERVAL_MS - elapsed;
      if (waitMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, waitMs);
        });
      }
    }
    this.lastRequestAt = Date.now();
  }
}
