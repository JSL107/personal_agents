// 리뷰 재생의 회차 재시도. 기준선은 120회가 전부 같은 모델로 채워져야 쓸 수 있는데, 모델 서버 혼잡
// ("Selected model is at capacity")·시간 초과 같은 일시 실패 하나가 그 회차를 스킵으로 만들어 2시간
// 실행 전체를 무효로 만들었다(2026-10-01). 재생은 폴백을 끄고 돌므로, 실패한 회차는 쉬었다가 같은
// 모델로 다시 시도한다. 재시도해도 안 되면 호출자가 스킵으로 남긴다 — 숨기지 않는다.
export const REPLAY_RETRY_DELAYS_MS: readonly number[] = [60_000, 180_000];

export type RetryHooks = {
  isRetryable: (error: unknown) => boolean;
  sleep: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

export const retryReplayTrial = async <T>(
  run: () => Promise<T>,
  { isRetryable, sleep, onRetry }: RetryHooks,
  delaysMs: readonly number[] = REPLAY_RETRY_DELAYS_MS,
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error: unknown) {
      const delayMs = delaysMs[attempt];
      if (delayMs === undefined || !isRetryable(error)) {
        throw error;
      }
      onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
};
