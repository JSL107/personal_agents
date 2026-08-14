import { fetchWithTimeout } from './fetch-with-timeout';

// 응답이 영원히 오지 않는 fetch — 실측된 매달림(run 551·591·651·655)을 재현한다.
const neverResponds = (): {
  fetchImpl: typeof fetch;
  signalOf: () => AbortSignal | undefined;
} => {
  let captured: AbortSignal | undefined;
  const fetchImpl = ((
    _input: unknown,
    init?: { signal?: AbortSignal | null },
  ) => {
    captured = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  return { fetchImpl, signalOf: () => captured };
};

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('fetchWithTimeout', () => {
  it('응답이 오지 않으면 상한을 넘긴 뒤 요청을 끊는다', async () => {
    const { fetchImpl, signalOf } = neverResponds();

    void fetchWithTimeout(20, fetchImpl)('https://api.github.com/repos/o/r');

    // 대조군 — 상한 전에는 살아 있어야 한다. 여기서 이미 aborted 면 상한이 아니라
    // 다른 이유로 끊긴 것이므로 이 테스트는 가드를 검증하지 못한다.
    expect(signalOf()?.aborted).toBe(false);

    await tick(60);
    expect(signalOf()?.aborted).toBe(true);
  });

  it('호출자가 준 signal 도 함께 존중한다', async () => {
    const { fetchImpl, signalOf } = neverResponds();
    const caller = new AbortController();

    void fetchWithTimeout(10_000, fetchImpl)(
      'https://api.github.com/repos/o/r',
      { signal: caller.signal },
    );

    expect(signalOf()?.aborted).toBe(false);

    // 상한(10초)에는 한참 못 미치지만 호출자가 끊으면 끊겨야 한다.
    caller.abort();
    await tick(0);
    expect(signalOf()?.aborted).toBe(true);
  });
});
