import { GateDecision, RedactedChange } from '../subconscious.type';

export const SUBCONSCIOUS_GATE = Symbol('SUBCONSCIOUS_GATE');

export interface SubconsciousGate {
  judge(changes: RedactedChange[]): Promise<GateDecision[]>;
}
