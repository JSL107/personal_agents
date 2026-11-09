import { FormatKnobValue, FormatPolicy } from '../format-policy';

export const REEL_FORMAT_DECISION_REPOSITORY_PORT = Symbol(
  'REEL_FORMAT_DECISION_REPOSITORY_PORT',
);

export interface ReelFormatDecisionInput {
  experimentId: string;
  knob: string;
  championValue: FormatKnobValue;
  challengerValue: FormatKnobValue;
  nChampion: number;
  nChallenger: number;
  excluded: number;
  statsJson: Record<string, unknown>;
  verdict: string;
  mode: string;
  reverseChallenge: boolean;
  reason: string;
  policyVersionBefore: number;
  policyVersionAfter: number;
  policyAfter: FormatPolicy;
  aiProposal: unknown;
  decidedAt: Date;
}
export interface ReelFormatDecision extends ReelFormatDecisionInput {
  id: string;
  reportedAt: Date | null;
  createdAt: Date;
}
export interface ReelFormatDecisionRepositoryPort {
  listAll(): Promise<ReelFormatDecision[]>;
  insert(row: ReelFormatDecisionInput): Promise<boolean>;
  markReported(ids: string[]): Promise<void>;
}
