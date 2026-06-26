import { StateSnapshot } from '../subconscious.type';

export const SUBCONSCIOUS_BASELINE_REPOSITORY = Symbol(
  'SUBCONSCIOUS_BASELINE_REPOSITORY',
);

export interface SubconsciousBaselineRepository {
  findBySource(
    ownerUserId: string,
    sourceId: string,
  ): Promise<StateSnapshot | null>;
  upsert(
    ownerUserId: string,
    sourceId: string,
    snapshot: StateSnapshot,
  ): Promise<void>;
}
