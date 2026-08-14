// GitHub API 호출은 응답이 끊겨도 fetch 가 스스로 포기하지 않는다. Octokit 도 기본 타임아웃을
// 두지 않으므로, 한 번 응답이 오지 않으면 그 호출을 감싼 AgentRun 이 IN_PROGRESS 인 채로 남는다.
//
// 실측(2026-08-14): CODE_REVIEWER run 551·591·651·655 가 각각 33·46·53·59 분 IN_PROGRESS 로
// 매달렸다가 시간당 도는 좀비 스위퍼에 FAILED 로 청소됐다. 같은 실행 구간에서 모델 호출은 이미
// 5분 × 2회(MODEL_ROUTER_WORST_CASE_MS ≈ 10.1분) 상한이 걸려 있어 33분을 만들 수 없다 —
// 상한이 없는 외부 호출은 GitHub API 쪽뿐이었다.
export const GITHUB_REQUEST_TIMEOUT_MS = 60_000;

// fetch 에 시간 상한을 씌운다. 호출자가 이미 signal 을 넘겼으면 그것도 함께 존중한다 —
// 덮어쓰면 Octokit 이 제공하는 요청 취소가 조용히 죽는다.
export const fetchWithTimeout =
  (timeoutMs: number, fetchImpl: typeof fetch = fetch): typeof fetch =>
  (input, init) =>
    fetchImpl(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
