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
  // EXPIRED 는 무응답 만료 종결 — recentDecisions 가 APPROVED/REJECTED 만 읽으므로 학습
  // 신호에는 들어가지 않고, countPendingSince 의 쿼터 가드만 풀어준다.
  markResolved(
    id: number,
    status: 'APPROVED' | 'REJECTED' | 'EXPIRED',
  ): Promise<void>;
  recentDecisions(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<PreferenceProposalRecord[]>;
  countPendingSince(ownerUserId: string, sinceMs: number): Promise<number>;
}
