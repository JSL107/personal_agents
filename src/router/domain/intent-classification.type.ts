import { AgentType } from '../../model-router/domain/model-router.type';

// 자연어 메시지를 AgentType 으로 분류한 결과. classifier 가 명확하지 않다고 판단하면 'UNKNOWN'.
// confidence 는 0~1 — 추후 manager 가 threshold 기반 user confirm 분기에 활용 가능.
export interface IntentClassification {
  agentType: AgentType | 'UNKNOWN';
  confidence: number;
  reason: string;
}
