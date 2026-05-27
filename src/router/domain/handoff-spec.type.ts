import { AgentType } from '../../model-router/domain/model-router.type';

// worker 가 다른 worker 호출을 manager 에 요청할 때 사용하는 명시적 위임 spec.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §5.2 — HandoffMessage 패턴 차용)
// manager 가 cycle / depth 검증 후 승인 시 다음 worker 를 dispatch 한다.
export interface HandoffSpec {
  toWorker: AgentType;
  reason: string;
  passthroughInput: Record<string, unknown>;
}
