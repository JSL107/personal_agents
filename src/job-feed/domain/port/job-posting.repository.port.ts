import { NormalizedJobPosting } from '../job-feed.type';

export const JOB_POSTING_REPOSITORY_PORT = Symbol(
  'JOB_POSTING_REPOSITORY_PORT',
);

export interface UpsertOutcome {
  created: number;
  updated: number;
  // 요건이 바뀌어 알림 표식을 되돌린 건수.
  contentChanged: number;
}

export interface StoredJobPosting {
  id: number;
  source: string;
  sourceId: string;
  company: string;
  title: string;
  detailUrl: string;
  skillTags: string[];
  rawSkillTags: string[];
  minYears: number | null;
  maxYears: number | null;
  experienceLevel: string | null;
  locations: string[];
  normalizedKey: string;
  jdText: string | null;
  matchScore: number | null;
}

export interface SaveScoreInput {
  id: number;
  matchScore: number;
  scoredProfileId: number | null;
}

export interface SaveDetailInput {
  id: number;
  jdText: string;
  skillTags: string[];
  rawSkillTags: string[];
}

export interface JobPostingRepositoryPort {
  upsertMany(postings: NormalizedJobPosting[]): Promise<UpsertOutcome>;
  findScoringTargets(profileId: number | null): Promise<StoredJobPosting[]>;
  saveScore(input: SaveScoreInput): Promise<void>;
  // avoidSkillTags 는 정규화(사전 통과)된 기술명이어야 skillTags 와 정확히 비교된다.
  // 하나라도 요구하는 공고는 알림 후보에서 뺀다 — 저장은 그대로 두고 알림만 거른다.
  findNotifiable(
    threshold: number,
    limit: number,
    avoidSkillTags: string[],
  ): Promise<StoredJobPosting[]>;
  // 같은 normalizedKey 의 모든 행을 한 번에 잠근다. 반환값이 false 면 다른 실행이 먼저 가져갔다.
  claimForNotification(normalizedKey: string, now: Date): Promise<boolean>;
  findDetailTargets(
    threshold: number,
    limit: number,
    staleBefore: Date,
  ): Promise<StoredJobPosting[]>;
  saveDetail(input: SaveDetailInput): Promise<void>;
  findGapCandidates(
    threshold: number,
    limit: number,
  ): Promise<StoredJobPosting[]>;
  saveGapAgentRunId(id: number, agentRunId: number): Promise<void>;
  // 사전 갱신 후 과거 행을 되살리는 용도다. 다른 조회와 달리 lastSeenAt 신선도
  // 조건을 걸면 안 된다 — 재파생의 목적 자체가 오래돼 조용히 방치된 행까지
  // 포함해 skillTags 를 되살리는 것이라, 신선도로 거르면 정작 손볼 대상이 빠진다.
  findAllForReprocess(): Promise<StoredJobPosting[]>;
  saveSkillTags(id: number, skillTags: string[]): Promise<void>;
  // 저장소에 "언제 마지막으로 수집했는지"를 기록하는 별도 필드가 없다 — 공고를
  // 마지막으로 본 시각(lastSeenAt) 의 최댓값이 곧 마지막 수집 성공 시각이다.
  // 자동 카드(Task 16)가 신선도 조건으로 조회가 조용히 비는 것과 수집기 장애를
  // 구분하는 각주(formatJobFeedDigest)에 쓴다.
  findLastCollectedAt(): Promise<Date | null>;
}
