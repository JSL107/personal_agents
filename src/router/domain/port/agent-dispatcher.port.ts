import { AgentType } from '../../../model-router/domain/model-router.type';
import { HandoffSpec } from '../handoff-spec.type';
import { DispatchInput } from '../idaeri-router.port';

// agent 별 worker 가 manager 의 dispatch 호출을 처리할 때의 표준 응답.
// DispatchResult 와의 차이: workerType 은 dispatcher 자체가 알기에 outcome 에 포함하지 않는다.
export interface DispatchOutcome {
  agentRunId: number;
  output: unknown;
  modelUsed: string;
  // worker 가 다른 worker 호출을 manager 에 요청할 때 채워 보낸다.
  followUp?: HandoffSpec;
}

// 각 agent module 이 자기 agentType 의 dispatch 책임을 register 하는 strategy.
// RouterModule 의 IdaeriRouterUsecase 가 multi-provider 로 받아 agentType → AgentDispatcher 매핑.
export interface AgentDispatcher {
  readonly agentType: AgentType;
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
}

// NestJS multi-provider 토큰 — `{ provide: AGENT_DISPATCHER_PORT, useClass: ..., multi: true }`.
// manager 가 `@Inject(AGENT_DISPATCHER_PORT) dispatchers: AgentDispatcher[]` 로 array 수신.
export const AGENT_DISPATCHER_PORT = Symbol('AGENT_DISPATCHER_PORT');
