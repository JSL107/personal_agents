import { PreferenceDiff } from '../preference-profile.type';

export const PREFERENCE_PROPOSAL_REPOSITORY = Symbol(
  'PREFERENCE_PROPOSAL_REPOSITORY',
);

export interface PreferenceProposalRecord {
  id: number;
  ownerUserId: string;
  baseVersion: number;
  diff: PreferenceDiff;
  rationale: string;
  status: string;
  createdAt: Date;
}

export interface CreateProposalInput {
  ownerUserId: string;
  baseVersion: number;
  diff: PreferenceDiff;
  rationale: string;
  slackChannelId?: string;
  slackMessageTs?: string;
}

export interface PreferenceProposalRepositoryPort {
  createPending(input: CreateProposalInput): Promise<number>;
  findById(id: number): Promise<PreferenceProposalRecord | null>;
  markResolved(id: number, status: 'APPROVED' | 'REJECTED'): Promise<void>;
  recentDecisions(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<PreferenceProposalRecord[]>;
  countPendingSince(ownerUserId: string, sinceMs: number): Promise<number>;
}
