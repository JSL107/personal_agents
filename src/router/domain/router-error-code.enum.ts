export enum RouterErrorCode {
  // agentTypeHint 가 비어 있고 intent classifier 미도입 단계 — 명시 hint 필수.
  INTENT_HINT_REQUIRED = 'INTENT_HINT_REQUIRED',
  // worker dispatcher registry 가 해당 agentType 을 등록하지 않은 경우.
  UNSUPPORTED_AGENT_TYPE = 'UNSUPPORTED_AGENT_TYPE',
  // handoff chain 안 같은 worker 가 재진입 — 무한 루프 차단.
  // (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4.3)
  CYCLE_DETECTED = 'CYCLE_DETECTED',
  // handoff chain 최대 깊이 (default 3) 초과.
  DEPTH_EXCEEDED = 'DEPTH_EXCEEDED',
  // intent classifier LLM call 실패 또는 결과 parse 실패.
  INTENT_CLASSIFY_FAILED = 'INTENT_CLASSIFY_FAILED',
}
