import { GateDecision, StateChange } from '../subconscious.type';

export const PROPOSAL_EMITTER = Symbol('PROPOSAL_EMITTER');

export interface ProposalEmitter {
  // 카드를 만들 이유가 있는지 사전 판정. 엔진이 promotion 예산을 소비하기 전에 물어본다
  // — 생략될 변경이 예산만 먹고 정작 유효한 제안이 밀리는 것을 막기 위함.
  shouldEmit(input: {
    ownerUserId: string;
    decision: GateDecision;
  }): Promise<boolean>;
  emit(input: {
    ownerUserId: string;
    change: StateChange;
    decision: GateDecision;
  }): Promise<void>;
}
