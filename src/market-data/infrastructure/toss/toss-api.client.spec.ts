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
});
