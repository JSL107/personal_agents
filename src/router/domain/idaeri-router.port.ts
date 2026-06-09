import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationContext } from './conversation-context.type';
import { ConversationTurn } from './conversation-memory.type';
import { HandoffSpec } from './handoff-spec.type';

export const IDAERI_ROUTER_PORT = Symbol('IDAERI_ROUTER_PORT');

// dispatch 진입점 — 사용자/cron/webhook 의 발화를 manager 에 전달한다.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §4.1)
export interface DispatchInput {
  source: DispatchSource;
  slackUserId: string;
  // 자연어 진입 시 사용자 메시지 원문 — intent classifier 가 agentTypeHint 추론에 사용.
  text?: string;
  // 슬래시 명령 / 명시적 호출 시 worker 지정. 없으면 manager 가 intent classifier 호출.
  agentTypeHint?: AgentType;
  // handoff chain 안에서 parent.id 전달 — 신규 AgentRun 의 parentId 컬럼에 기록.
  contextRefs?: { agentRunId?: number };
  // 자연어 multi-turn 메모리 (Slack message handler 가 주입). intent classifier 가
  // 지시대명사 ("그거 분배해") 의 prior worker 추론 정확도 ↑. dispatch 자체에는 영향 X —
  // classifier 호출 시 systemPrompt 컨텍스트로만 사용.
  priorTurns?: ConversationTurn[];
  // 워커 실행 입력까지 전달되는 대화 맥락. 보통 router 가 classify 결과(userInstruction) +
  // contextRefs.agentRunId 로 직접 구성해 dispatcher 에 넘긴다 (외부 주입 시 그대로 사용).
  conversationContext?: ConversationContext;
}

export type DispatchSource =
  | 'SLACK_MESSAGE'
  | 'SLACK_COMMAND'
  | 'CRON'
  | 'WEBHOOK';

// manager 가 worker 호출 결과를 사용자에게 돌려줄 때의 표준 응답.
// followUp 은 worker 가 추가 worker 호출을 요청한 경우 — manager 가 cycle/depth 검증 후 dispatch.
// formattedText 는 dispatcher 가 채운 Slack mrkdwn 응답 — 자연어 진입 (app_mention) 의 직접 답글 텍스트.
// handoffResults — chain 안에서 본 worker 가 호출한 후속 worker 들의 DispatchResult 누적.
// root (top-level) DispatchResult 는 chain 의 모든 child 를 평탄화해 갖는다. 사용자에게 chain 전체
// 가시화 + 결과 footer 에 worker 시퀀스 요약 표시 가능.
export interface DispatchResult {
  agentRunId: number;
  workerType: AgentType;
  output: unknown;
  modelUsed: string;
  formattedText: string;
  followUp?: HandoffSpec;
  handoffResults?: DispatchResult[];
}

// Hierarchical Manager Pattern 의 manager-agent.
// scaffold 단계는 worker dispatcher registry 가 비어 있어 모든 dispatch 가 UNSUPPORTED 로 throw.
// (다음 plan 진입 시 worker dispatcher 등록 + intent classifier 통합.)
export interface IdaeriRouterPort {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}
