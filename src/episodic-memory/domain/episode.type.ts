// Episodic Memory 도메인 타입 — spec 2026-06-18.
//
// `pr_review` 는 뺐다. PR 리뷰 되먹임이 의미검색(episodic) 대신 기각 이유를 레포 규약으로
// 싣는 방식(#382)으로 바뀌면서 읽는 코드가 사라졌고, 쓰는 코드만 남아 있었다. 기존 행은
// DB 에 그대로 있으나 조회하는 경로가 없다.
// `routing_example` 은 라우터가 쌓는 (사용자 요청문 → 최종 담당) 짝이다. agent_run 의 content 는
// 워커 출력이라 요청문 질의와 형태가 달라 few-shot 이 엉뚱하게 붙었다(2026-11-02 재생 9/43).
export type EpisodeKind =
  | 'agent_run'
  | 'conversation'
  | 'manual'
  | 'routing_example';

export interface RecordEpisodeInput {
  kind: EpisodeKind;
  agentRunId?: number;
  agentType?: string;
  content: string;
  occurredAt: Date;
  // 임베딩 접두어. 기본 'passage'. 질의와 같은 모양의 짧은 문장(routing_example)은 'query' 로
  // 저장해야 같은 문장의 cosine 이 1 에 붙는다 — passage/query 로 엇갈리면 0.94 안팎에 머문다.
  embedAs?: 'query' | 'passage';
  // 같은 kind·agentType·content 가 이미 있으면 넣지 않는다. 반복 요청의 사본이 검색 상한(LIMIT)을
  // 채워 다른 문장을 밀어내지 않게 한다(routing_example).
  skipIfSameContent?: boolean;
}

export interface SearchEpisodesInput {
  query: string;
  kind?: EpisodeKind;
  agentType?: string;
  limit: number;
  // recency 감쇠 반감기(일). 미지정 시 service 기본값.
  halfLifeDays?: number;
  // HNSW 근사 대신 정확 검색. 인덱스는 모든 kind 가 공유해 근사 후보를 먼저 뽑고 kind 로 거르면
  // 행이 적은 kind 는 결과가 비어 버린다.
  exact?: boolean;
}

export interface EpisodeSearchHit {
  id: number;
  agentRunId: number | null;
  // few-shot worker 라벨 / 작업 텍스트(원문 — 소비처가 truncate).
  agentType: string | null;
  content: string;
  // cosine similarity(0~1)에 recency 가중을 곱한 최종 점수. 클수록 관련.
  score: number;
  // 감쇠 없는 cosine similarity. 임계값 비교는 이 값으로 한다 — score 는 날짜에 따라 변한다.
  similarity: number;
  occurredAt: Date;
}
