import {
  DecisionStatsRecord,
  ReelFormatDecisionMode,
  ReelFormatDecisionReason,
  ReelFormatVerdict,
} from '../format-decision.policy';
import { FormatKnob, FormatKnobValue, FormatPolicy } from '../format-policy';
import { PlannerProposal } from './reel-format-planner.port';

export type ReelFormatAiProposal = PlannerProposal | { error: string } | null;

export const REEL_FORMAT_DECISION_REPOSITORY_PORT = Symbol(
  'REEL_FORMAT_DECISION_REPOSITORY_PORT',
);

export interface ReelFormatDecisionInput {
  experimentId: string;
  knob: FormatKnob;
  championValue: FormatKnobValue;
  challengerValue: FormatKnobValue;
  nChampion: number;
  nChallenger: number;
  excluded: number;
  statsJson: DecisionStatsRecord;
  verdict: ReelFormatVerdict;
  mode: ReelFormatDecisionMode;
  reverseChallenge: boolean;
  reason: ReelFormatDecisionReason;
  policyVersionBefore: number;
  policyVersionAfter: number;
  policyAfter: FormatPolicy;
  aiProposal: ReelFormatAiProposal;
  decidedAt: Date;
}
export interface ReelFormatDecision extends ReelFormatDecisionInput {
  id: string;
  reportedAt: Date | null;
  createdAt: Date;
}
export interface ReelFormatDecisionRepositoryPort {
  listAll(): Promise<ReelFormatDecision[]>;
  insert(row: ReelFormatDecisionInput): Promise<ReelFormatDecision | null>;
  markReported(ids: string[]): Promise<void>;
}
