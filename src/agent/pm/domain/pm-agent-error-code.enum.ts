export enum PmAgentErrorCode {
  EMPTY_TASKS_INPUT = 'PM_AGENT_EMPTY_TASKS_INPUT',
  INVALID_MODEL_OUTPUT = 'PM_AGENT_INVALID_MODEL_OUTPUT',
  // PM-2 /sync-plan: 직전 PM 실행이 없거나 DailyPlan 으로 해석 불가.
  NO_RECENT_PLAN = 'PM_AGENT_NO_RECENT_PLAN',
  // PM-2 /sync-plan: GITHUB/NOTION source + subtasks 가 있는 후보가 plan 에 없음.
  NO_WRITE_BACK_CANDIDATES = 'PM_AGENT_NO_WRITE_BACK_CANDIDATES',
}
