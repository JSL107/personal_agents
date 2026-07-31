// LLM CLI(codex / claude) 자식 프로세스 호출의 표준 응답 timeout (ms).
//
// ModelRouterUsecase.route() 는 현재 전체 에이전트를 codex 단일 provider 로 호출한다.
// fallback 은 2026-07-02 제거됐고, CodexCliProvider 가 일시성 실패를 bounded retry 한다.
// 따라서 한 번의 route() 호출은 최악의 경우 codex timeout 을 2회 누적한다.
//
// 이 값을 단일 소스로 두고 두 CLI provider(codex-cli / claude-cli.provider.ts) 와
// BullMQ worker lockDuration 계산(common/queue/worker-options.constant.ts) 이 함께 참조한다.
// → timeout 을 바꾸면 worker lockDuration 도 자동으로 일관되게 따라간다 (이전엔 주석으로만
//   결합돼 있어 lockDuration 이 단일 호출 180s 만 가정 → fallback 경로 미흡수 → stalled 발생).
export const LLM_CLI_TIMEOUT_MS = 180_000;

// CLI provider 의 bounded retry 파라미터. worst-case 계산이 이 값들을 함께 봐야 하므로
// provider 안에 두지 않고 timeout 과 같은 파일에 모은다 (CodexCliProvider 가 그대로 import).
export const LLM_CLI_MAX_ATTEMPTS = 2;
export const LLM_CLI_RETRY_BACKOFF_BASE_MS = 1_000;
export const LLM_CLI_RETRY_BACKOFF_JITTER_MS = 1_000;

// attempt 당 자식 프로세스 부대비용 예산 — mkdtemp 2회(workDir/homeDir) + spawn + rm -rf 2회.
// 실측은 수십~수백 ms 수준이라 넉넉히 잡는다. worst-case 를 조금 크게 잡는 쪽이 안전하다:
// 작으면 정상 실행이 "이상" 으로 오탐되고, 커봐야 32분급 이상 징후 탐지에는 영향이 없다.
const LLM_CLI_PROCESS_OVERHEAD_MS = 2_000;

// route() 한 번의 worst-case latency.
//   timeout × attempts + attempt 사이 backoff 상한 + attempt 당 프로세스 부대비용
// backoff/부대비용을 빼면 "두 attempt 가 모두 정상 timeout 된" 경로(180s + 최대 2s + 180s)만으로도
// 임계를 넘겨, ModelRouterUsecase.warnIfSlow 가 정상 동작에 이상 경고를 남긴다 (PR #182 리뷰 지적).
export const MODEL_ROUTER_WORST_CASE_MS =
  LLM_CLI_MAX_ATTEMPTS * LLM_CLI_TIMEOUT_MS +
  (LLM_CLI_MAX_ATTEMPTS - 1) *
    (LLM_CLI_RETRY_BACKOFF_BASE_MS + LLM_CLI_RETRY_BACKOFF_JITTER_MS) +
  LLM_CLI_MAX_ATTEMPTS * LLM_CLI_PROCESS_OVERHEAD_MS;
