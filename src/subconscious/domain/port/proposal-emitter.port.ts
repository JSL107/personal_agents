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
  // 이미 뜬 카드 중 스윕이 대신 처리한 것을 닫고, 닫은 수를 돌려준다.
  // 카드는 생성 시점엔 중복이 아니었다가 몇 초~몇 분 뒤 스윕이 같은 PR 을 리뷰하면서
  // 무의미해진다(실측 2026-09-09 PR #149: 15초, 09-08 #143: 5분 29초). 생성 시점 판정만으로는
  // 이 창을 막을 수 없어 tick 마다 사후로 한 번 닫는다.
  dismissSweptPending(ownerUserId: string): Promise<number>;
}
