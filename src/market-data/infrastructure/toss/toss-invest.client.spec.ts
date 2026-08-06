import { ConfigService } from '@nestjs/config';

import { TossApiClient } from './toss-api.client';
import { TossInvestClient } from './toss-invest.client';

const createJsonResponse = (body: unknown): Response => {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// 실측(2026-08-06 첫 실호출) 형태 그대로. `/holdings` 는 result 가 객체이고 그 안에 items 배열,
// 값은 전부 문자열이다. 실제 응답에는 marketValue·profitLoss 등 집계 필드가 더 붙지만
// 매퍼가 쓰지 않아 생략한다.
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

// 실측(2026-08-06) — `/accounts` 는 result 가 **배열 그 자체**다. holdings 와 형태가 다르다.
// 이 차이를 몰라 파서가 `result.items` 를 기대했고, 첫 실호출이 통째로 실패했다.
const ACCOUNTS_RESPONSE = {
  result: [
    { accountNo: '12345678901', accountSeq: 1, accountType: 'BROKERAGE' },
  ],
};

const TOKEN_RESPONSE = {
  access_token: 'token-1',
  token_type: 'Bearer',
  expires_in: 120,
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
    client = new TossInvestClient(
      new TossApiClient(configService),
      configService,
    );
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

  it('credential 미설정이면 기존 잔고 동기화 오류 문구를 보존한다', async () => {
    const configService = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    const clientWithoutCredential = new TossInvestClient(
      new TossApiClient(configService),
      configService,
    );

    await expect(clientWithoutCredential.fetchHoldings()).rejects.toThrow(
      '토스증권 잔고 동기화가 비활성 상태입니다. TOSS_CLIENT_ID와 TOSS_CLIENT_SECRET을 설정하세요.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// 위 describe 는 TOSS_ACCOUNT_SEQ 를 항상 설정해 `/accounts` 경로를 한 번도 타지 않았다.
// 그래서 계좌 목록 파서가 실제 응답과 어긋난 채로 남아 있었고, 첫 실호출에서야 드러났다.
// 계좌 미설정 경로를 실제 응답 형태로 고정한다.
describe('TossInvestClient 계좌 자동 선택', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let client: TossInvestClient;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    const config: Record<string, string | undefined> = {
      TOSS_CLIENT_ID: 'client-id',
      TOSS_CLIENT_SECRET: 'client-secret',
      TOSS_ACCOUNT_SEQ: undefined,
    };
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    client = new TossInvestClient(
      new TossApiClient(configService),
      configService,
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('accountSeq 미설정이면 /accounts 의 BROKERAGE 계좌를 골라 헤더에 넣는다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(ACCOUNTS_RESPONSE))
      .mockResolvedValueOnce(createJsonResponse(HOLDINGS_RESPONSE));

    const holdings = await client.fetchHoldings();

    expect(holdings).toHaveLength(1);
    const holdingsCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/holdings'),
    );
    const headers = new Headers(holdingsCall?.[1]?.headers);
    expect(headers.get('X-Tossinvest-Account')).toBe('1');
  });

  it('BROKERAGE 계좌가 없으면 명시 오류로 끊는다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(
        createJsonResponse({
          result: [{ accountNo: '999', accountSeq: 2, accountType: 'PENSION' }],
        }),
      );

    await expect(client.fetchHoldings()).rejects.toThrow(
      'BROKERAGE 계좌를 찾을 수 없습니다',
    );
  });

  it('예전에 기대하던 result.items 형태는 더 이상 계좌 목록으로 받지 않는다', async () => {
    // 실측에 없는 형태다. 받아주면 "이 형태도 온다"는 잘못된 계약이 남는다.
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(
        createJsonResponse({
          result: { items: [{ accountSeq: 1, accountType: 'BROKERAGE' }] },
        }),
      );

    await expect(client.fetchHoldings()).rejects.toThrow(
      '계좌 목록 응답 형식이 올바르지 않습니다',
    );
  });

  it('result 봉투 밖의 계좌 배열은 받지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse(TOKEN_RESPONSE))
      .mockResolvedValueOnce(
        createJsonResponse([
          { accountNo: '12345678901', accountSeq: 1, accountType: 'BROKERAGE' },
        ]),
      )
      .mockResolvedValueOnce(createJsonResponse(HOLDINGS_RESPONSE));

    await expect(client.fetchHoldings()).rejects.toThrow(
      '계좌 목록 응답 형식이 올바르지 않습니다',
    );
  });
});
