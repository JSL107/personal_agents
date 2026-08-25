import { Injectable } from '@nestjs/common';

import { MarketDataRateLimitError } from '../../domain/market-data-rate-limit.error';
import {
  BenchmarkBar,
  FetchDailyClosesOptions,
  MarketIndicatorPort,
} from '../../domain/port/market-indicator.port';
import { TossApiClient, TossApiHttpError } from './toss-api.client';
import { mapTossMarketIndicatorResponse } from './toss-market-indicator.mapper';

const MAXIMUM_CANDLE_COUNT = 200;

@Injectable()
export class TossMarketIndicatorClient implements MarketIndicatorPort {
  constructor(private readonly tossApi: TossApiClient) {}

  async fetchDailyCloses(
    symbol: string,
    count: number,
    options?: FetchDailyClosesOptions,
  ): Promise<BenchmarkBar[]> {
    if (count <= 0) {
      return [];
    }

    const limitedCount = Math.min(count, MAXIMUM_CANDLE_COUNT);
    const query = new URLSearchParams({
      interval: '1d',
      count: String(limitedCount),
    });
    if (options?.before) {
      query.set('before', options.before);
    }
    const path =
      `/api/v1/market-indicators/${encodeURIComponent(symbol)}/candles` +
      `?${query.toString()}`;
    let response: unknown;
    try {
      response = await this.tossApi.requestJson('시장 지표 일봉 조회', path);
    } catch (error) {
      if (error instanceof TossApiHttpError && error.status === 429) {
        throw new MarketDataRateLimitError();
      }
      throw error;
    }

    const bars = mapTossMarketIndicatorResponse(response);
    if (!bars) {
      throw new Error(
        `토스증권 시장 지표 일봉 응답 형식이 올바르지 않습니다 — ${symbol}`,
      );
    }

    // 한 번에 최대 200봉(약 10개월)이다. 그보다 긴 구간은 호출부가 `before` 커서로
    // 페이지를 이어 받는다.
    return bars.slice(-count);
  }
}
