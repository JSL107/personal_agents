import { AgentType } from '../../../model-router/domain/model-router.type';

// CTO 의 분배 후보 — review 합의에 따라 BE_SRE / BE_FIX 는 webhook 자동 트리거 영역이라 제외.
// BE / BE_SCHEMA / BE_TEST 만 사용자 트리거로 분배 가능.
export type BeAssignmentType =
  | AgentType.BE
  | AgentType.BE_SCHEMA
  | AgentType.BE_TEST;

export interface Assignment {
  // PM plan 의 morning/afternoon TaskItem.id — assignableTaskIds 안의 1개.
  taskId: string;
  // PM plan 의 task title (사용자 가시 메시지). LLM 이 plan JSON 에서 추출.
  taskTitle: string;
  beAssignment: BeAssignmentType;
  priority: 1 | 2 | 3;
  // 한 줄 분배 근거 — 사용자가 결과 검토 시 read.
  reasoning: string;
  // 0~1 — LLM 의 분배 확신도. 0.6 미만이면 사용자 confirm 권장 (formatter 에서 ⚠️ 표시).
  confidence: number;
}

// 자동 분배 불가 한 task — taskId + 사용자에게 결정 요청할 사유.
// codex review 권장: first-class output 으로 노출, /assign 재시도 시 사용자가 worker override.
export interface UnassignedTask {
  taskId: string;
  taskTitle: string;
  reason: string;
}

export interface AssignmentOutput {
  assignments: Assignment[];
  unassignedTasks: UnassignedTask[];
  // 전체 분배 정책 / context 요약 — 사용자 가시 footer.
  ctoSummary: string;
}

export interface GenerateAssignmentInput {
  slackUserId: string;
  // 명시 지정 시 해당 PM run 의 assignableTaskIds 분배. 미지정 시 직전 PM run 자동 조회.
  dailyPlanAgentRunId?: number;
}
