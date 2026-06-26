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
