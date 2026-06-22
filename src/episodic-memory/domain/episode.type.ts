// Episodic Memory 도메인 타입 — spec 2026-06-18.
export type EpisodeKind = 'agent_run' | 'conversation' | 'manual';

export interface RecordEpisodeInput {
  kind: EpisodeKind;
  agentRunId?: number;
  agentType?: string;
  content: string;
  occurredAt: Date;
}

export interface SearchEpisodesInput {
  query: string;
  kind?: EpisodeKind;
  agentType?: string;
  limit: number;
  // recency 감쇠 반감기(일). 미지정 시 service 기본값.
  halfLifeDays?: number;
}

export interface EpisodeSearchHit {
  id: number;
  agentRunId: number | null;
  // few-shot worker 라벨 / 작업 텍스트(원문 — 소비처가 truncate).
  agentType: string | null;
  content: string;
  // cosine similarity(0~1)에 recency 가중을 곱한 최종 점수. 클수록 관련.
  score: number;
  occurredAt: Date;
}
