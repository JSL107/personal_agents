import { AgentType } from '../../model-router/domain/model-router.type';

// 자연어 multi-turn 메모리 한 turn — user 입력 또는 assistant (봇) 응답 1개.
// (도입 plan: V3 비전 봇 쪼개기 의 자연어 진입 step 다음 단계 — 사용자 ↔ 봇 multi-turn 컨텍스트.)
//
// role:
//   - 'user': 사용자 입력. agentType = 분류된 worker (UNKNOWN 또는 dispatch 실패 시 null).
//   - 'assistant': 봇 응답 (conversational reply 또는 worker reply 요약). agentType 은 직전 user
//     turn 의 worker 와 동일 — UI 표시용. agentRunId 도 그대로 미러링.
//
// role 미설정 (legacy / Redis 기존 entry) 시 'user' 로 해석 — 기존 stored turn 호환.
//
// agentType / agentRunId 는 분류/디스패치 실패 시 null — 그런 turn 도 메모리에 남겨야
// "방금 그건 분류 실패" 같은 사용자 회복 흐름 인식 가능.
export type ConversationTurnRole = 'user' | 'assistant';

export interface ConversationTurn {
  role?: ConversationTurnRole;
  text: string;
  agentType: AgentType | null;
  agentRunId: number | null;
  timestampMs: number;
}
