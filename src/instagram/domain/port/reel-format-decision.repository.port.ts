import {
  DecisionStatsRecord,
  ReelFormatDecisionMode,
  ReelFormatVerdict,
} from '../format-decision.policy';
import { FormatKnob, FormatKnobValue, FormatPolicy } from '../format-policy';
import { PlannerProposal } from './reel-format-planner.port';

export type ReelFormatAiProposal = PlannerProposal | { error: string } | null;

export const REEL_FORMAT_DECISION_REPOSITORY_PORT = Symbol(
  'REEL_FORMAT_DECISION_REPOSITORY_PORT',
);

interface ReelFormatDecisionFields<PolicyAfter, StoredValue> {
  experimentId: string;
  knob: FormatKnob;
  championValue: StoredValue;
  challengerValue: StoredValue;
  nChampion: number;
  nChallenger: number;
  excluded: number;
  statsJson: DecisionStatsRecord;
  verdict: ReelFormatVerdict;
  mode: ReelFormatDecisionMode;
  reverseChallenge: boolean;
  reason: string;
  policyVersionBefore: number;
  policyVersionAfter: number;
  policyAfter: PolicyAfter;
  aiProposal: ReelFormatAiProposal;
  decidedAt: Date;
}
export type ReelFormatDecisionInput = ReelFormatDecisionFields<
  FormatPolicy,
  FormatKnobValue
>;
export interface ReelFormatDecision extends ReelFormatDecisionFields<
  FormatPolicy | null,
  FormatKnobValue | null
> {
  id: string;
  reportedAt: Date | null;
  createdAt: Date;
}
export interface ReelFormatDecisionRepositoryPort {
  listAll(): Promise<ReelFormatDecision[]>;
  insert(row: ReelFormatDecisionInput): Promise<boolean>;
  markReported(ids: string[]): Promise<void>;
}
