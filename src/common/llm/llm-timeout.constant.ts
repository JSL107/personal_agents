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

// route() 한 번의 worst-case latency — codex 최대 2회 시도 누적.
export const MODEL_ROUTER_WORST_CASE_MS = 2 * LLM_CLI_TIMEOUT_MS;
