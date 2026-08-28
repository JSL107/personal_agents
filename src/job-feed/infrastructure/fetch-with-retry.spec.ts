import { JobSourceId } from '../domain/job-feed.type';
import { fetchJsonWithRetry } from './fetch-with-retry';
import { JobFeedPermanentError } from './job-feed-permanent.error';
import { JobFeedRateLimitError } from './job-feed-rate-limit.error';

const createJsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
};

const SOURCE: JobSourceId = 'jumpit';

const requestOnce = (): Promise<unknown> => {
  return fetchJsonWithRetry({
    source: SOURCE,
    url: 'https://example.test/list',
    timeoutMs: 1_000,
    headers: {},
    label: '테스트',
  });
};

describe('fetchJsonWithRetry', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-27T00:00:00.000Z'));
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('429 는 재시도하고, 예산을 다 쓰면 JobFeedRateLimitError 타입을 보존한다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({}, 429));

    const pending = requestOnce();
    const assertion = expect(pending).rejects.toBeInstanceOf(
      JobFeedRateLimitError,
    );
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('500 은 재시도한다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({}, 500));

    const pending = requestOnce();
    const assertion = expect(pending).rejects.toThrow('HTTP 500');
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 408 은 서버가 유휴 연결을 닫거나 요청을 기다리다 타임아웃했을 때 보내는 것이라
  // 429 와 같은 성격으로 재시도 대상이다 — 영구 실패로 분류하면 안 된다.
  it('408 은 재시도한다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({}, 408));

    const pending = requestOnce();
    const assertion = expect(pending).rejects.toThrow('HTTP 408');
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('404 는 즉시 실패하고 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({}, 404));

    await expect(requestOnce()).rejects.toBeInstanceOf(JobFeedPermanentError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 이번 수정으로 새로 커버되는 상태 코드 — 이전엔 목록에 없어 불필요하게 재시도됐다.
  it('422 는 즉시 실패하고 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({}, 422));

    await expect(requestOnce()).rejects.toBeInstanceOf(JobFeedPermanentError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('정상 응답은 JSON 을 그대로 반환한다', async () => {
    fetchMock.mockResolvedValue(createJsonResponse({ ok: true }));

    await expect(requestOnce()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
