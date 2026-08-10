import { ConfigService } from '@nestjs/config';

import { TossApiClient } from './toss-api.client';

const createJsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

// 실측(2026-08-06) — 한도 초과 시 서버가 주는 형태.
const RATE_LIMIT_RESPONSE = {
  error: {
    code: 'rate-limit-exceeded',
    message: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
  },
};

const TOKEN_RESPONSE = {
  access_token: 'token-1',
  token_type: 'Bearer',
  expires_in: 120,
};

const CANDLES_RESPONSE = { result: { candles: [] } };

describe('TossApiClient HTTP 오류', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let client: TossApiClient;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
    fetchMock = jest.spyOn(globalThis, 'fetch');
    const config = {
      TOSS_CLIENT_ID: 'client-id',
      TOSS_CLIENT_SECRET: 'client-secret',
    };
    const configService = {
      get: jest.fn((key: keyof typeof config) => config[key]),
    } as unknown as ConfigService;
    client = new TossApiClient(configService);
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('HTTP 429 를 만나면 재시도 없이 즉시 오류로 끊는다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValue(createJsonResponse(RATE_LIMIT_RESPONSE, 429));

    const pending = client.requestJson('일봉 조회', '/api/v1/candles');
    const assertion = expect(pending).rejects.toThrow('HTTP 429');
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('429 가 아닌 오류는 재시도하지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse({}, 500));

    await expect(
      client.requestJson('일봉 조회', '/api/v1/candles'),
    ).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('조회가 401이면 토큰을 한 번 재발급한 뒤 같은 조회를 다시 시도한다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse({}, 401))
      .mockResolvedValueOnce(
        createJsonResponse({ ...TOKEN_RESPONSE, access_token: 'token-2' }),
      )
      .mockResolvedValueOnce(createJsonResponse(CANDLES_RESPONSE));

    await expect(
      client.requestJson('일봉 조회', '/api/v1/candles'),
    ).resolves.toEqual(CANDLES_RESPONSE);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://openapi.tossinvest.com/oauth2/token',
      'https://openapi.tossinvest.com/api/v1/candles',
      'https://openapi.tossinvest.com/oauth2/token',
      'https://openapi.tossinvest.com/api/v1/candles',
    ]);
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get('Authorization'),
    ).toBe('Bearer token-1');
    expect(
      new Headers(fetchMock.mock.calls[3][1]?.headers).get('Authorization'),
    ).toBe('Bearer token-2');
  });

  it('재시도한 조회도 401이면 토큰을 두 번만 발급하고 오류를 던진다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse({}, 401))
      .mockResolvedValueOnce(
        createJsonResponse({ ...TOKEN_RESPONSE, access_token: 'token-2' }),
      )
      .mockResolvedValueOnce(createJsonResponse({}, 401));

    await expect(
      client.requestJson('일봉 조회', '/api/v1/candles'),
    ).rejects.toThrow('토스증권 일봉 조회 실패: HTTP 401');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/oauth2/token'),
      ),
    ).toHaveLength(2);
  });

  it.each([403, 500])(
    '조회가 HTTP %i이면 토큰 재발급 없이 오류를 던진다',
    async (status: number) => {
      fetchMock
        .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
        .mockResolvedValueOnce(createJsonResponse({}, status));

      await expect(
        client.requestJson('일봉 조회', '/api/v1/candles'),
      ).rejects.toThrow(`토스증권 일봉 조회 실패: HTTP ${status}`);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).endsWith('/oauth2/token'),
        ),
      ).toHaveLength(1);
    },
  );

  // 타임아웃이 없으면 응답을 주지 않는 서버에 매달려 autopilot worker 의 lockDuration 을
  // 넘기고, BullMQ 가 같은 job 을 stalled 로 보고 재처리한다.
  it('토큰 발급과 본 요청 모두에 타임아웃 signal 을 붙인다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(CANDLES_RESPONSE));

    await client.requestJson('일봉 조회', '/api/v1/candles');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
