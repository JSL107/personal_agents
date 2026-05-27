import { AgentType } from '../../../model-router/domain/model-router.type';
import { HandoffSpec } from '../handoff-spec.type';
import { DispatchInput } from '../idaeri-router.port';

// agent 별 worker 가 manager 의 dispatch 호출을 처리할 때의 표준 응답.
// DispatchResult 와의 차이: workerType 은 dispatcher 자체가 알기에 outcome 에 포함하지 않는다.
//
// formattedText 는 worker 별 Slack mrkdwn formatter (slack/format/<x>.formatter.ts) 결과 — handler
// 가 별도 worker 분기 없이 그대로 say. step 7 으로 자연어 → 풍부한 결과 답글이 가능해진다.
export interface DispatchOutcome {
  agentRunId: number;
  output: unknown;
  modelUsed: string;
  formattedText: string;
  // worker 가 다른 worker 호출을 manager 에 요청할 때 채워 보낸다.
  followUp?: HandoffSpec;
}

// 각 agent module 이 자기 agentType 의 dispatch 책임을 구현하는 strategy.
// agent module 의 providers 에 dispatcher class 를 등록하고 exports 에 노출하면,
// RouterModule 이 모든 dispatcher 를 한 useFactory 에 inject 해 array 로 합친다.
//
// 분산 multi-provider 패턴 (module 별로 각자 multi 등록) 은 NestJS 가 module 경계를 넘어
// 합치지 않는 동작 때문에 array 가 되지 않는다. 따라서 RouterModule 에서 중앙 inject 하는
// PreviewGate.forRoot 패턴을 차용 — 본 파일은 토큰 + 인터페이스만 노출.
export interface AgentDispatcher {
  readonly agentType: AgentType;
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
}

// AGENT_DISPATCHER_PORT — RouterModule 의 useFactory 가 채우는 AgentDispatcher[] 토큰.
// 소비자는 `@Inject(AGENT_DISPATCHER_PORT) dispatchers: AgentDispatcher[]` 로 받는다.
export const AGENT_DISPATCHER_PORT = Symbol('AGENT_DISPATCHER_PORT');
