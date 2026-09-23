import { ConfigService } from '@nestjs/config';

import { KoreanHolidayApiClient } from './korean-holiday.api-client';

// 공공데이터포털 「디코딩」 키는 `+`·`/`·`=` 를 포함한 raw base64 다. 이 문자들이 URL 에
// 어떻게 실리는지가 이 테스트의 핵심이다.
const DECODED_KEY = 'ab+cd/ef==';

const buildClient = (
  key: string | undefined,
): { client: KoreanHolidayApiClient } => {
  const configService = {
    get: (name: string): string | undefined =>
      name === 'KOREAN_HOLIDAY_API_KEY' ? key : undefined,
  } as unknown as ConfigService;
  return { client: new KoreanHolidayApiClient(configService) };
};

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    text: (): Promise<string> => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

describe('KoreanHolidayApiClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('키가 없으면 isConfigured 가 false — 호출부가 이걸 보고 건너뛴다', () => {
    expect(buildClient(undefined).client.isConfigured()).toBe(false);
    expect(buildClient('   ').client.isConfigured()).toBe(false);
    expect(buildClient(DECODED_KEY).client.isConfigured()).toBe(true);
  });

  it('조회 파라미터를 규격대로 싣는다 — solMonth 는 2자리', async () => {
    let requested = '';
    global.fetch = jest.fn((input: URL | RequestInfo): Promise<Response> => {
      requested = String(input);
      return Promise.resolve(
        jsonResponse({ response: { body: { items: '' } } }),
      );
    }) as unknown as typeof fetch;

    await buildClient(DECODED_KEY).client.fetchMonth(2026, 3);

    const url = new URL(requested);
    expect(url.searchParams.get('solYear')).toBe('2026');
    expect(url.searchParams.get('solMonth')).toBe('03');
    expect(url.searchParams.get('_type')).toBe('json');
    // 기본값(10)을 그대로 두면 연휴가 긴 달에서 잘린다.
    expect(Number(url.searchParams.get('numOfRows'))).toBeGreaterThanOrEqual(
      100,
    );
  });

  // 인코딩 키를 넣으면 `%2B` 가 `%252B` 가 되어 서비스키 불일치로 떨어지는데, 증상이
  // "등록되지 않은 키" 라 키를 다시 발급받는 쪽으로 헤매게 된다. 읽어낸 값이 원래 키와
  // 같아야 이중 인코딩이 아니다.
  it('서비스키를 이중 인코딩하지 않는다', async () => {
    let requested = '';
    global.fetch = jest.fn((input: URL | RequestInfo): Promise<Response> => {
      requested = String(input);
      return Promise.resolve(
        jsonResponse({ response: { body: { items: '' } } }),
      );
    }) as unknown as typeof fetch;

    await buildClient(DECODED_KEY).client.fetchMonth(2026, 1);

    expect(new URL(requested).searchParams.get('serviceKey')).toBe(DECODED_KEY);
  });

  // 포털은 같은 키를 「인코딩」·「디코딩」 두 벌로 준다. 인코딩 키를 그대로 넘기면
  // `URLSearchParams` 가 한 번 더 인코딩해 `%2B` 가 `%252B` 가 되고, 서버는
  // SERVICE_KEY_IS_NOT_REGISTERED_ERROR 로 답한다 — 멀쩡한 키를 의심하게 만드는 증상이라
  // 2026-09-23 실제로 그 함정에 빠졌다. 어느 쪽을 넣어도 같은 값이 실려야 한다.
  it('인코딩 키를 넣어도 디코딩 키와 같은 값이 실린다', async () => {
    let requested = '';
    global.fetch = jest.fn((input: URL | RequestInfo): Promise<Response> => {
      requested = String(input);
      return Promise.resolve(
        jsonResponse({ response: { body: { items: '' } } }),
      );
    }) as unknown as typeof fetch;

    // `ab+cd/ef==` 의 인코딩 형태.
    await buildClient('ab%2Bcd%2Fef%3D%3D').client.fetchMonth(2026, 1);

    expect(new URL(requested).searchParams.get('serviceKey')).toBe(DECODED_KEY);
  });

  it('키가 없는데 호출하면 던진다 — 빈 배열로 돌려주면 "공휴일 없는 해" 로 보인다', async () => {
    await expect(
      buildClient(undefined).client.fetchMonth(2026, 1),
    ).rejects.toThrow('KOREAN_HOLIDAY_API_KEY');
  });

  it('HTTP 실패는 연월과 함께 던진다', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        text: (): Promise<string> => Promise.resolve(''),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    await expect(
      buildClient(DECODED_KEY).client.fetchMonth(2026, 8),
    ).rejects.toThrow('2026-08');
  });

  // 실측(2026-09-23): 잘못된 키는 200 이 아니라 **403** 과 함께 사유를 본문에 담아 온다.
  // 상태 코드만 남기면 키가 틀린 것인지·권한이 없는 것인지·트래픽을 넘긴 것인지 구분되지
  // 않아, 정작 고칠 곳을 못 찾고 키를 다시 발급받는 쪽으로 헤매게 된다.
  it('403 응답의 사유를 예외에 싣는다 — 상태 코드만으로는 무엇이 문제인지 모른다', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 403,
        text: (): Promise<string> =>
          Promise.resolve(
            '{"OpenAPI_ServiceResponse":{"cmmMsgHeader":{"errMsg":"SERVICE_KEY_IS_NOT_REGISTERED_ERROR","returnReasonCode":"30"}}}',
          ),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    await expect(
      buildClient(DECODED_KEY).client.fetchMonth(2026, 1),
    ).rejects.toThrow('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
  });

  // 키가 틀리거나 트래픽이 초과되면 200 에 XML 오류 문서가 실려 온다. 본문 첫 줄이
  // 유일한 단서라 예외에 싣는다.
  it('JSON 이 아닌 본문은 원문 일부를 담아 던진다', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: (): Promise<string> =>
          Promise.resolve(
            '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg>',
          ),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    await expect(
      buildClient(DECODED_KEY).client.fetchMonth(2026, 1),
    ).rejects.toThrow('SERVICE_KEY_IS_NOT_REGISTERED_ERROR');
  });
});
