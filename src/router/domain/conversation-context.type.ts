// 워커 실행 입력까지 전달되는 대화 맥락. 기존에는 priorTurns 가 IntentClassifier 의 분류
// 힌트로만 쓰이고 워커 execute() 입력에는 닿지 않아, 직전 대화에서 한 얘기를 이어받지
// 못했다 (예: 봇이 "우선순위 정리해볼까요?" 직후 사용자가 "네 정리해주세요" 해도 워커는
// 일반 daily plan 을 새로 생성). ConversationContext 는 그 단절을 잇는다.
//
// 전부 optional — 미주입 시 기존 동작 그대로 (하위 호환).
export interface ConversationContext {
  // 자연어 분류 단계에서 직전 대화를 근거로 추출한 "이 worker 가 반영할 사용자 추가 지시".
  // 직전 대화에 명시적 지시/제약이 있을 때만 채워진다 (보수적 추출). 없으면 undefined.
  userInstruction?: string;
  // 직전 turn 의 worker AgentRun id. worker 가 이전 결과를 이어받을 때 참조.
  priorAgentRunId?: number;
}
