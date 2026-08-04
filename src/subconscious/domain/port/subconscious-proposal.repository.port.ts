export const SUBCONSCIOUS_PROPOSAL_REPOSITORY = Symbol(
  'SUBCONSCIOUS_PROPOSAL_REPOSITORY',
);

export type ProposalStatus = 'PENDING' | 'DISPATCHED' | 'DISMISSED';

export interface SubconsciousProposalRecord {
  id: number;
  ownerUserId: string;
  sourceId: string;
  changeKey: string;
  suggestedAgentType: string;
  proposalText: string;
  contextJson: unknown;
  status: ProposalStatus;
  slackChannelId: string | null;
  slackMessageTs: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface CreateProposalInput {
  ownerUserId: string;
  sourceId: string;
  changeKey: string;
  suggestedAgentType: string;
  proposalText: string;
  contextJson: unknown;
}

export interface SubconsciousProposalRepository {
  create(input: CreateProposalInput): Promise<SubconsciousProposalRecord>;
  findById(id: number): Promise<SubconsciousProposalRecord | null>;
  // 같은 대상에 아직 응답하지 않은 카드가 있는지 — 중복 카드 생성을 막는 판정 근거.
  // createdAfter 는 TTL 하한. 만료된 PENDING 은 눌러도 실행되지 않는 죽은 카드이므로
  // 중복 판정에서 빼야 한다 (안 그러면 그 대상의 제안이 영구히 막힌다).
  hasPending(
    ownerUserId: string,
    changeKey: string,
    createdAfter: Date,
  ): Promise<boolean>;
  markStatus(
    id: number,
    status: Exclude<ProposalStatus, 'PENDING'>,
    resolvedAt?: Date,
  ): Promise<void>;
  transitionFromPending(
    id: number,
    toStatus: Exclude<ProposalStatus, 'PENDING'>,
    resolvedAt: Date,
  ): Promise<boolean>;
  attachSlackMessage(
    id: number,
    channelId: string,
    messageTs: string,
  ): Promise<void>;
}
