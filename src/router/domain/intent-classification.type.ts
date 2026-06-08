import { AgentType } from '../../model-router/domain/model-router.type';

// 자연어 메시지를 AgentType 으로 분류한 결과. classifier 가 명확하지 않다고 판단하면 'UNKNOWN'.
// confidence 는 0~1 — 추후 manager 가 threshold 기반 user confirm 분기에 활용 가능.
export interface IntentClassification {
  agentType: AgentType | 'UNKNOWN';
  confidence: number;
  reason: string;
  // 직전 대화를 근거로 추출한 "이 worker 가 반영할 사용자 추가 지시" (예: "직전 논의한
  // 개선 항목을 우선순위화"). 직전 대화에 명시적 지시/제약이 있을 때만 채워진다 (보수적).
  // ConversationContext.userInstruction 으로 워커 실행 입력까지 전달된다.
  userInstruction?: string;
}
