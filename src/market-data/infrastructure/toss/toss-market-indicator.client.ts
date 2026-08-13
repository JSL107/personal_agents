import { Injectable } from '@nestjs/common';

import { MarketDataRateLimitError } from '../../domain/market-data-rate-limit.error';
import {
  BenchmarkBar,
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
  ): Promise<BenchmarkBar[]> {
    if (count <= 0) {
      return [];
    }

    const limitedCount = Math.min(count, MAXIMUM_CANDLE_COUNT);
    const path =
      `/api/v1/market-indicators/${encodeURIComponent(symbol)}/candles` +
      `?interval=1d&count=${limitedCount}`;
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

    // ponytail: 페이지네이션을 쓰지 않아 한 번에 최대 200봉(약 10개월)만 수집한다.
    // 더 긴 성적 구간이 필요해지면 응답의 `nextBefore`를 다음 요청의 `before`로 넘겨 확장한다.
    return bars.slice(-count);
  }
}
