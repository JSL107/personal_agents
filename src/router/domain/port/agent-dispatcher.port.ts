import { Provider, Type } from '@nestjs/common';

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

// 각 agent module 이 자기 agentType 의 dispatch 책임을 register 하는 strategy.
// RouterModule 의 IdaeriRouterUsecase 가 multi-provider 로 받아 agentType → AgentDispatcher 매핑.
export interface AgentDispatcher {
  readonly agentType: AgentType;
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
}

// NestJS multi-provider 토큰 — `{ provide: AGENT_DISPATCHER_PORT, useClass: ..., multi: true }`.
// manager 가 `@Inject(AGENT_DISPATCHER_PORT) dispatchers: AgentDispatcher[]` 로 array 수신.
export const AGENT_DISPATCHER_PORT = Symbol('AGENT_DISPATCHER_PORT');

// NestJS 10 의 Provider type 정의에는 `multi` 필드가 빠져 있어 (runtime 은 지원) inline 으로
// `{ ..., multi: true }` 를 쓰면 TS2353. 각 agent module 이 동일 cast 를 반복하지 않도록 helper 로
// 캡슐화 — agent module 은 `provideAgentDispatcher(PmDispatcher)` 한 줄로 multi-provider 등록.
//
// 주의 — useExisting + multi 는 NestJS 10 의 DI 에서 작동하지 않는다 (multi 무시되고 single
// alias 로만 등록 → 소비자가 array 가 아닌 single instance 를 받음, runtime TypeError).
// useFactory + inject 패턴은 multi 와 정상 호환 — dispatcher 의 기존 provider instance 를
// inject 받아 identity 그대로 반환하면 stateless 한 dispatcher 들이 array 에 push 된다.
export const provideAgentDispatcher = (
  dispatcher: Type<AgentDispatcher>,
): Provider =>
  ({
    provide: AGENT_DISPATCHER_PORT,
    useFactory: (instance: AgentDispatcher) => instance,
    inject: [dispatcher],
    multi: true,
  }) as unknown as Provider;
