import { MarketDataRateLimitError } from '../../domain/market-data-rate-limit.error';
import { TossApiClient, TossApiHttpError } from './toss-api.client';
import { TossMarketIndicatorClient } from './toss-market-indicator.client';

const CANDLES_RESPONSE = {
  result: {
    candles: [
      {
        timestamp: '2026-08-12T00:00:00.000+09:00',
        openPrice: '3220.12',
        highPrice: '3230.44',
        lowPrice: '3201.08',
        closePrice: '3215.68',
        volume: '531245678',
      },
    ],
    nextBefore: '2026-08-11T00:00:00.000+09:00',
  },
};

const createTossApi = (): jest.Mocked<TossApiClient> => {
  return {
    requestJson: jest.fn(),
  } as unknown as jest.Mocked<TossApiClient>;
};

describe('TossMarketIndicatorClient', () => {
  it('심볼을 경로 인코딩하고 count를 200으로 제한해 일봉을 조회한다', async () => {
    const tossApi = createTossApi();
    tossApi.requestJson.mockResolvedValue(CANDLES_RESPONSE);
    const client = new TossMarketIndicatorClient(tossApi);

    await expect(client.fetchDailyCloses('KOSPI/A', 500)).resolves.toHaveLength(
      1,
    );
    expect(tossApi.requestJson).toHaveBeenCalledWith(
      '시장 지표 일봉 조회',
      '/api/v1/market-indicators/KOSPI%2FA/candles?interval=1d&count=200',
    );
  });

  it('before 커서를 시장 지표 일봉 쿼리에 전달한다', async () => {
    const tossApi = createTossApi();
    tossApi.requestJson.mockResolvedValue(CANDLES_RESPONSE);
    const client = new TossMarketIndicatorClient(tossApi);

    await client.fetchDailyCloses('KOSPI', 200, {
      before: '2026-08-11T00:00:00.000+09:00',
    });

    expect(tossApi.requestJson).toHaveBeenCalledWith(
      '시장 지표 일봉 조회',
      '/api/v1/market-indicators/KOSPI/candles?interval=1d&count=200&before=2026-08-11T00%3A00%3A00.000%2B09%3A00',
    );
  });

  it('count가 0 이하면 요청하지 않고 빈 배열을 반환한다', async () => {
    const tossApi = createTossApi();
    const client = new TossMarketIndicatorClient(tossApi);

    await expect(client.fetchDailyCloses('KOSPI', 0)).resolves.toEqual([]);
    expect(tossApi.requestJson).not.toHaveBeenCalled();
  });

  it('토스 HTTP 429를 시세 조회 rate limit 도메인 오류로 변환한다', async () => {
    const tossApi = createTossApi();
    tossApi.requestJson.mockRejectedValue(
      new TossApiHttpError('rate limited', 429),
    );
    const client = new TossMarketIndicatorClient(tossApi);

    await expect(client.fetchDailyCloses('KOSPI', 5)).rejects.toBeInstanceOf(
      MarketDataRateLimitError,
    );
  });

  it('429가 아닌 토스 HTTP 오류는 변환하지 않는다', async () => {
    const tossApi = createTossApi();
    const error = new TossApiHttpError('server error', 500);
    tossApi.requestJson.mockRejectedValue(error);
    const client = new TossMarketIndicatorClient(tossApi);

    await expect(client.fetchDailyCloses('KOSPI', 5)).rejects.toBe(error);
  });

  it('캔들 응답이 올바르지 않으면 심볼을 포함한 오류를 던진다', async () => {
    const tossApi = createTossApi();
    tossApi.requestJson.mockResolvedValue({ result: { items: [] } });
    const client = new TossMarketIndicatorClient(tossApi);

    await expect(client.fetchDailyCloses('KOSPI', 5)).rejects.toThrow(
      '토스증권 시장 지표 일봉 응답 형식이 올바르지 않습니다 — KOSPI',
    );
  });
});
