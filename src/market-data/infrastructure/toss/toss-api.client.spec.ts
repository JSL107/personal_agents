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

describe('TossApiClient 레이트리밋 재시도', () => {
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

  it('HTTP 429 를 만나면 1초 뒤 한 번 다시 시도한다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(RATE_LIMIT_RESPONSE, 429))
      .mockResolvedValueOnce(createJsonResponse(CANDLES_RESPONSE));

    const pending = client.requestJson('일봉 조회', '/api/v1/candles');
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual(CANDLES_RESPONSE);
    // 토큰 발급 1회 + 429 1회 + 재시도 1회
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('재시도까지 429 면 무한 반복하지 않고 오류로 끊는다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValue(createJsonResponse(RATE_LIMIT_RESPONSE, 429));

    const pending = client.requestJson('일봉 조회', '/api/v1/candles');
    const assertion = expect(pending).rejects.toThrow('HTTP 429');
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
});
