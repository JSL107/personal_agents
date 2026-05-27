export enum PoEvalErrorCode {
  // range 안에 3 sub-agent (WORK_REVIEWER / PO_SHADOW / IMPACT_REPORTER) 의 successful run 이
  // 모두 없는 경우 — 최소 1개라도 있어야 합성 가능 (graceful 정책 — review omc:architect).
  NO_SUB_AGENT_RUNS = 'NO_SUB_AGENT_RUNS',
  // LLM 출력이 EvaluationOutput schema 와 안 맞음.
  PARSE_FAILED = 'PARSE_FAILED',
}
