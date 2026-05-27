export enum CtoErrorCode {
  // /assign 호출 시 사용자의 직전 PM run 이 없음 — /today 먼저 실행 안내.
  NO_RECENT_PM_RUN = 'NO_RECENT_PM_RUN',
  // 직전 PM run 이 staleness threshold (18h) 초과 — 최신 plan 으로 재실행 안내.
  STALE_PM_RUN = 'STALE_PM_RUN',
  // 직전 PM run output 의 assignableTaskIds 가 빈 array 또는 미정의 — 자동 분배 후보 없음.
  NO_ASSIGNABLE_TASKS = 'NO_ASSIGNABLE_TASKS',
  // LLM 출력이 AssignmentOutput schema 와 안 맞음.
  PARSE_FAILED = 'PARSE_FAILED',
}
