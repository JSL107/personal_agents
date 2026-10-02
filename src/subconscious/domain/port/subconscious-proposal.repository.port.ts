export const SUBCONSCIOUS_PROPOSAL_REPOSITORY = Symbol(
  'SUBCONSCIOUS_PROPOSAL_REPOSITORY',
);

// 닫힌 이유를 값으로 가른다. 전부 DISMISSED 로 쓰던 동안 사용자 거절·만료·스윕 대체가 구분되지
// 않아, 만료 53건이 거절로 읽혔다(2026-09-30 실측, DISMISSED 62건 중).
export type ProposalStatus =
  | 'PENDING'
  | 'DISPATCHED'
  | 'DISMISSED' // 사용자가 ❌ 를 눌렀다 — 이 뜻으로만 쓴다
  | 'EXPIRED' // TTL 이 지나 코드가 닫았다
  | 'SUPERSEDED'; // PR 리뷰 스윕이 같은 PR 을 이미 리뷰해 코드가 닫았다

// 카드가 어디서 왔나. DROP_SAMPLE = legacy 게이트가 버린(promote=false) 변경을 무작위로 골라
// 사람 판정에 올린 것 — 버린 영역의 정답 라벨을 모으려는 표본이다. 카드 문구로는 구분하지 않고
// (판정이 끌려가지 않게) 이 값으로만 가른다.
export type ProposalOrigin = 'GATE' | 'DROP_SAMPLE';

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
  origin?: ProposalOrigin;
}

export interface SubconsciousProposalRepository {
  create(input: CreateProposalInput): Promise<SubconsciousProposalRecord>;
  findById(id: number): Promise<SubconsciousProposalRecord | null>;
  // 같은 대상에 `createdAfter` 이후로 제안한 적이 있는지 — 중복 카드 생성을 막는 판정 근거.
  // 상태를 가리지 않는다: PENDING 만 세던 동안 카드가 만료·응답으로 PENDING 을 벗어나면
  // 같은 대상이 다시 통과해, PR 한 건에 제안이 17회까지 쌓였다(2026-09-18 실측, #52).
  //
  // 만료 카드를 세지 않으려던 원래 의도는 "그 대상이 영구히 막히는 것" 을 피하려는 것이었다.
  // 같은 목적을 기간 창(호출부의 재제안 금지 기간)으로 달성한다 — 창을 넘기면 다시 통과한다.
  hasProposedSince(
    ownerUserId: string,
    changeKey: string,
    createdAfter: Date,
  ): Promise<boolean>;
  // 표본 일일 상한 판정용 — 해당 origin 으로 since 이후 만든 카드 수(상태 무관).
  countByOriginSince(
    ownerUserId: string,
    origin: ProposalOrigin,
    since: Date,
  ): Promise<number>;
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
