export enum AgentRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

// 에이전트 실행을 촉발한 트리거 출처. 기획서 §11.1 trigger_type 필드에 대응.
export enum TriggerType {
  SLACK_COMMAND_TODAY = 'SLACK_COMMAND_TODAY',
  SLACK_COMMAND_WORKLOG = 'SLACK_COMMAND_WORKLOG',
  SLACK_COMMAND_REVIEW_PR = 'SLACK_COMMAND_REVIEW_PR',
  SLACK_COMMAND_PLAN_TASK = 'SLACK_COMMAND_PLAN_TASK',
  SLACK_COMMAND_IMPACT_REPORT = 'SLACK_COMMAND_IMPACT_REPORT',
  SLACK_COMMAND_PO_SHADOW = 'SLACK_COMMAND_PO_SHADOW',
  // OPS-8: Morning Briefing CRON 자동 발화 — 수동 /today (SLACK_COMMAND_TODAY) 와 분석/Failure Replay 시 구분 가능.
  MORNING_BRIEFING_CRON = 'MORNING_BRIEFING_CRON',
  // PRO-4: Weekly Summary CRON 자동 발화 — 수동 /worklog (SLACK_COMMAND_WORKLOG) 와 구분.
  WEEKLY_SUMMARY_CRON = 'WEEKLY_SUMMARY_CRON',
  SCHEDULED = 'SCHEDULED',
  MANUAL = 'MANUAL',
  FAILURE_REPLAY = 'FAILURE_REPLAY',
  WEBHOOK = 'WEBHOOK',
  SLACK_COMMAND_BE_SCHEMA = 'SLACK_COMMAND_BE_SCHEMA',
  SLACK_COMMAND_BE_TEST = 'SLACK_COMMAND_BE_TEST',
  SLACK_COMMAND_BE_SRE = 'SLACK_COMMAND_BE_SRE',
  SLACK_COMMAND_BE_FIX = 'SLACK_COMMAND_BE_FIX',
  // V3 비전 P2 Assign — CTO worker (/assign 슬래시). PM 직전 plan 의 assignableTaskIds → BE 5종 분배.
  SLACK_COMMAND_ASSIGN = 'SLACK_COMMAND_ASSIGN',
  // V3 비전 P4 Evaluate — PO 통합 facade (/po-eval 슬래시). 3 sub-agent snapshot 합성 + careerLog.
  SLACK_COMMAND_PO_EVAL = 'SLACK_COMMAND_PO_EVAL',
  // V3 비전 P5 Meta — CEO worker (/ceo-review 슬래시). PO_EVAL + PM/CTO snapshot 합성 → drift/docs review.
  SLACK_COMMAND_CEO_REVIEW = 'SLACK_COMMAND_CEO_REVIEW',
}

// payload 는 JSON 직렬화 가능한 임의 데이터 (object / array / primitive).
// caller 가 domain 객체를 그대로 넘기도록 unknown 으로 두고, Prisma 저장 경계에서만 InputJsonValue 로 cast.
export interface EvidenceInput {
  sourceType: string;
  sourceId: string;
  url?: string;
  title?: string;
  excerpt?: string;
  payload: unknown;
}
