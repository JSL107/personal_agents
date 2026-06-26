import { GateDecision, StateChange } from '../subconscious.type';

export const PROPOSAL_EMITTER = Symbol('PROPOSAL_EMITTER');

export interface ProposalEmitter {
  emit(input: {
    ownerUserId: string;
    change: StateChange;
    decision: GateDecision;
  }): Promise<void>;
}
