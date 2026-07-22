import { ConfigService } from '@nestjs/config';

import { TossInvestClient } from './toss-invest.client';

const createJsonResponse = (body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const HOLDINGS_RESPONSE = {
  result: {
    items: [
      {
        symbol: '005930',
        name: '삼성전자',
        marketCountry: 'KR',
        currency: 'KRW',
        quantity: '100',
        lastPrice: '72000',
        averagePurchasePrice: '65000',
      },
    ],
  },
};

describe('TossInvestClient token cache', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let client: TossInvestClient;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T00:00:00.000Z'));
    fetchMock = jest.spyOn(globalThis, 'fetch');
    const config = {
      TOSS_CLIENT_ID: 'client-id',
      TOSS_CLIENT_SECRET: 'client-secret',
      TOSS_ACCOUNT_SEQ: '12345',
    };
    const configService = {
      get: jest.fn((key: keyof typeof config) => config[key]),
    } as unknown as ConfigService;
    client = new TossInvestClient(configService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('만료 안전 구간 전에는 발급한 토큰을 재사용한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'token-1',
          token_type: 'Bearer',
          expires_in: 120,
        }),
      )
      .mockImplementation(() =>
        Promise.resolve(createJsonResponse(HOLDINGS_RESPONSE)),
      );

    await client.fetchHoldings();
    jest.advanceTimersByTime(59_999);
    await client.fetchHoldings();

    const tokenRequests = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/oauth2/token'),
    );
    expect(tokenRequests).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('만료 60초 전 갱신 구간에 들어가면 토큰을 재발급한다', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'token-1',
          token_type: 'Bearer',
          expires_in: 120,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(HOLDINGS_RESPONSE))
      .mockResolvedValueOnce(
        createJsonResponse({
          access_token: 'token-2',
          token_type: 'Bearer',
          expires_in: 120,
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(HOLDINGS_RESPONSE));

    await client.fetchHoldings();
    jest.advanceTimersByTime(60_000);
    await client.fetchHoldings();

    const tokenRequests = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/oauth2/token'),
    );
    expect(tokenRequests).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
