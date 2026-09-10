// 주간 판정 계열 autopilot task(knowledge-lint L4 · docs-sync-audit Layer2)의 발화 흔적 포트.
// Slack digest 발송(summaryText)은 사후 조회·집계가 안 되므로, "발화했다/게이트 상태/
// 판정 대상 건수/LLM 호출 여부" 를 별도로 남겨 사후에 원인(게이트 OFF · 대상 0건 · 미발화)을
// 가릴 수 있게 한다.

export interface AutopilotTaskTraceInput {
  taskId: string;
  firedAtKst: string;
  gateEnabled: boolean;
  // 판정 대상 건수(L4 후보 쌍 수 / 드리프트 SoT 파일 수). 게이트가 꺼져 있어 세지 않았거나,
  // 판정 도중 예외로 확정 전에 중단됐으면 null.
  candidateCount: number | null;
  // 실제 LLM 호출이 있었는가. 위와 같은 이유로 알 수 없으면 null.
  llmCalled: boolean | null;
  // 사람이 읽는 보충 설명(쿼터 소진 중단, 예외 메시지 등). 없으면 생략.
  detail?: string;
}

export interface AutopilotTaskTracePort {
  // best-effort — 기록 실패가 원 task 의 성공/실패를 바꾸지 않는다(구현체가 내부에서 swallow).
  record(input: AutopilotTaskTraceInput): Promise<void>;
}

export const AUTOPILOT_TASK_TRACE_PORT = Symbol('AUTOPILOT_TASK_TRACE_PORT');
