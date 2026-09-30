import { RoutedVia } from '../../../agent-run/domain/agent-run.type';

// 라우터가 dispatch 했는데 새 AgentRun 이 열리지 않은 회차 한 건.
export interface RoutingNoRunInput {
  routedTo: string;
  routedVia: RoutedVia;
  confidence: number | null;
  // 원장 규칙(마스킹 + 길이 상한)을 이미 거친 원문 — routing-context.ts toLedgerRoutedText.
  routedText: string;
  agentRunId: number;
  reusedAgentRun: boolean;
  modelUsed: string;
}

export interface RoutingNoRunPort {
  // best-effort — 구현체가 실패를 삼킨다. 기록이 사용자 응답을 막으면 안 된다.
  record(input: RoutingNoRunInput): Promise<void>;
}

export const ROUTING_NO_RUN_PORT = Symbol('ROUTING_NO_RUN_PORT');
