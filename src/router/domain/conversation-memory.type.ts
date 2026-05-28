import { AgentType } from '../../model-router/domain/model-router.type';

// 자연어 multi-turn 메모리 한 turn — 사용자 입력 1개 + 분류된 worker + dispatch 결과 ID + 시간.
// (도입 plan: V3 비전 봇 쪼개기 의 자연어 진입 step 다음 단계 — 사용자 ↔ 봇 multi-turn 컨텍스트.)
//
// agentType / agentRunId 는 분류/디스패치 실패 시 null — 그런 turn 도 메모리에 남겨야
// "방금 그건 분류 실패" 같은 사용자 회복 흐름 인식 가능.
export interface ConversationTurn {
  text: string;
  agentType: AgentType | null;
  agentRunId: number | null;
  timestampMs: number;
}
