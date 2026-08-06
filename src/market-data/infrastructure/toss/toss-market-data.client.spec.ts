import { YahooFinanceMarketDataClient } from '../yahoo-finance.market-data.client';
import { TossApiClient } from './toss-api.client';
import { TossMarketDataClient } from './toss-market-data.client';

const CANDLES_RESPONSE = {
  result: {
    candles: [
      {
        timestamp: '2026-08-06T00:00:00.000+09:00',
        openPrice: '12290',
        highPrice: '12370',
        lowPrice: '12230',
        closePrice: '12255',
        volume: '70940',
        currency: 'KRW',
      },
    ],
    nextBefore: '2026-08-05T00:00:00.000+09:00',
  },
};

const createTossApi = (): jest.Mocked<TossApiClient> => {
  return {
    requestJson: jest.fn(),
  } as unknown as jest.Mocked<TossApiClient>;
};

const createYahooMarketData = (): jest.Mocked<YahooFinanceMarketDataClient> => {
  return {
    fetchUsdKrwRate: jest.fn(),
  } as unknown as jest.Mocked<YahooFinanceMarketDataClient>;
};

describe('TossMarketDataClient', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('days=500 요청을 count=200으로 제한하고 반환한다', async () => {
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    tossApi.requestJson.mockResolvedValue(CANDLES_RESPONSE);
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    const bars = await client.fetchDailyBars('483280', 500);

    expect(bars).toHaveLength(1);
    expect(tossApi.requestJson).toHaveBeenCalledWith(
      '일봉 조회',
      '/api/v1/candles?symbol=483280&interval=1d&count=200&adjusted=true',
    );
  });

  // 판정이 조정 계열에 의존한다. 이 값을 토스 기본값에 맡기면 토스가 기본값을 바꾸는 날
  // 배당락이 가짜 급락으로 잡히기 시작하는데, 어디에도 오류가 남지 않는다.
  it('수정주가 적용을 쿼리에 명시한다', async () => {
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    tossApi.requestJson.mockResolvedValue(CANDLES_RESPONSE);
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    await client.fetchDailyBars('114800', 5);

    const [, path] = tossApi.requestJson.mock.calls[0];
    expect(path).toContain('adjusted=true');
  });

  it('토스 HTTP 429 오류를 호출자에게 전파한다', async () => {
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    tossApi.requestJson.mockRejectedValue(
      new Error('토스증권 일봉 조회 실패: HTTP 429 Too Many Requests'),
    );
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    await expect(client.fetchDailyBars('PFE', 1)).rejects.toThrow('HTTP 429');
  });

  it('캔들 봉투가 올바르지 않으면 심볼을 포함한 명시 오류를 던진다', async () => {
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    tossApi.requestJson.mockResolvedValue({ result: { items: [] } });
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    await expect(client.fetchDailyBars('SPYM', 1)).rejects.toThrow(
      '토스증권 일봉 응답 형식이 올바르지 않습니다 — SPYM',
    );
  });

  it('연속 일봉 요청을 최소 220ms 간격으로 실행한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    tossApi.requestJson.mockResolvedValue(CANDLES_RESPONSE);
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    await client.fetchDailyBars('483280', 1);
    const secondRequest = client.fetchDailyBars('PFE', 1);
    await jest.advanceTimersByTimeAsync(219);

    expect(tossApi.requestJson).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await secondRequest;

    expect(tossApi.requestJson).toHaveBeenCalledTimes(2);
  });

  it('환율은 Yahoo client에 위임한다', async () => {
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    yahooMarketData.fetchUsdKrwRate.mockResolvedValue('1387.4');
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    const rate = await client.fetchUsdKrwRate();

    expect(rate).toBe('1387.4');
    expect(yahooMarketData.fetchUsdKrwRate).toHaveBeenCalledTimes(1);
  });

  it('days가 0 이하이면 토스 API를 호출하지 않는다', async () => {
    const tossApi = createTossApi();
    const yahooMarketData = createYahooMarketData();
    const client = new TossMarketDataClient(tossApi, yahooMarketData);

    await expect(client.fetchDailyBars('483280', 0)).resolves.toEqual([]);

    expect(tossApi.requestJson).not.toHaveBeenCalled();
  });
});
