// Episodic Memory 도메인 타입 — spec 2026-06-18.
//
// `pr_review` 는 뺐다. PR 리뷰 되먹임이 의미검색(episodic) 대신 기각 이유를 레포 규약으로
// 싣는 방식(#382)으로 바뀌면서 읽는 코드가 사라졌고, 쓰는 코드만 남아 있었다. 기존 행은
// DB 에 그대로 있으나 조회하는 경로가 없다.
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
