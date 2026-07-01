import { PreferenceSignal } from '../preference-signal.type';

export const PREFERENCE_SIGNAL_SOURCES = Symbol('PREFERENCE_SIGNAL_SOURCES');

export interface PreferenceSignalSource {
  readonly name: string;
  fetch(ownerUserId: string, sinceMs: number): Promise<PreferenceSignal[]>;
}
