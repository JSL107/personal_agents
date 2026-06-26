import { StateSnapshot } from '../subconscious.type';

export const STATE_SOURCES = Symbol('STATE_SOURCES');

export interface StateSource {
  readonly id: string;
  fetchSnapshot(ownerSlackUserId: string): Promise<StateSnapshot>;
}
