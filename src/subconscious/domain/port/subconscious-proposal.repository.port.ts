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
  // 아직 응답하지 않은 카드 전량 — 사후 무효화가 훑는 입력.
  listPending(ownerUserId: string): Promise<SubconsciousProposalRecord[]>;
  // createdBefore 이전에 만들어진 미응답 카드를 한 번에 DISMISSED 로 닫고 닫은 수를 돌려준다.
  // 만료 카드는 눌러도 실행되지 않으므로(assertReadyToResolve) 개별 판정이 필요 없다. 순회
  // 대신 일괄 갱신인 이유는 회차 상한을 먹지 않아야 하기 때문 — 아래 dismissSweptPending 주석 참조.
  expirePendingOlderThan(
    ownerUserId: string,
    createdBefore: Date,
  ): Promise<number>;
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
