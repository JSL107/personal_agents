export const REACTION_SIGNAL_REPOSITORY = Symbol('REACTION_SIGNAL_REPOSITORY');

export interface RecordReactionInput {
  slackUserId: string;
  channelId: string;
  messageTs: string;
  emoji: string;
  messageText: string;
}

export interface ReactionSignalRow {
  id: number;
  emoji: string;
  messageText: string;
}

export interface ReactionSignalRepositoryPort {
  // 같은 반응이 토글(끄기 → 켜기)로 두 번 들어와도 중복 저장하지 않는다 — 구현은 unique
  // 제약 위반을 조용히 무시한다.
  record(input: RecordReactionInput): Promise<void>;
  recentReactions(
    ownerUserId: string,
    sinceMs: number,
  ): Promise<ReactionSignalRow[]>;
}
