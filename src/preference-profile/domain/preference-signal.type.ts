export type SignalSource =
  | 'proposal_decision'
  | 'episodic_correction'
  | 'reaction';

export interface PreferenceSignal {
  source: SignalSource;
  evidenceRef: string; // "preferenceProposal:9" 등 추적용
  observedText: string;
}
