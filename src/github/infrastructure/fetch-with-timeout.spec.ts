import { fetchWithTimeout } from './fetch-with-timeout';

// 응답이 영원히 오지 않는 fetch — 실측된 매달림(run 551·591·651·655)을 재현한다.
// 실제 fetch 처럼 signal 이 abort 되면 그 reason 으로 reject 한다. abort 를 무시하고 pending 인
// 채로 두면 "signal 이 끊겼다" 까지만 보이고, 이 PR 의 목적인 "그래서 호출자가 기존 에러 처리
// 경로로 돌아간다" 는 검증되지 않는다.
const neverResponds = (): {
  fetchImpl: typeof fetch;
  signalOf: () => AbortSignal | undefined;
} => {
  let captured: AbortSignal | undefined;
  const fetchImpl = ((
    _input: unknown,
    init?: { signal?: AbortSignal | null },
  ) => {
    const signal = init?.signal ?? undefined;
    captured = signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal === undefined) {
        return;
      }
      signal.addEventListener('abort', () => {
        reject(signal.reason ?? new Error('aborted'));
      });
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, signalOf: () => captured };
};

describe('fetchWithTimeout', () => {
  it('응답이 오지 않으면 상한을 넘긴 뒤 요청을 끊고 호출자에게 에러를 돌려준다', async () => {
    const { fetchImpl, signalOf } = neverResponds();

    const outcome = fetchWithTimeout(
      20,
      fetchImpl,
    )('https://api.github.com/repos/o/r').then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );

    // 대조군 — 상한 전에는 살아 있어야 한다. 여기서 이미 aborted 면 상한이 아니라 다른 이유로
    // 끊긴 것이므로 이 테스트는 가드를 검증하지 못한다.
    expect(signalOf()?.aborted).toBe(false);

    const settled = await outcome;

    expect(signalOf()?.aborted).toBe(true);
    // 매달린 채 pending 으로 남지 않고 rejection 으로 끝나야 호출자의 catch 가 잡는다.
    expect(settled).not.toBe('resolved');
    expect((settled as Error).name).toBe('TimeoutError');
  });

  it('호출자가 준 signal 도 함께 존중한다', async () => {
    const { fetchImpl, signalOf } = neverResponds();
    const caller = new AbortController();

    const outcome = fetchWithTimeout(10_000, fetchImpl)(
      'https://api.github.com/repos/o/r',
      { signal: caller.signal },
    ).then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );

    expect(signalOf()?.aborted).toBe(false);

    // 상한(10초)에는 한참 못 미치지만 호출자가 끊으면 끊겨야 한다.
    caller.abort(new Error('caller cancelled'));
    const settled = await outcome;

    expect(signalOf()?.aborted).toBe(true);
    expect(settled).not.toBe('resolved');
    expect((settled as Error).message).toBe('caller cancelled');
  });
});
