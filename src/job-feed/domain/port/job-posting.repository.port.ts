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
  // avoidSkillTags — findNotifiable 과 같은 계약이다. 상세수집 예산(JOB_FEED_DETAIL_LIMIT)을
  // 기피 공고가 차지하지 않게 걸러야 한다(안 걸면 알림엔 안 뜨는 공고가 상세 호출
  // 순번은 그대로 차지해, 정작 보여줄 공고의 상세 수집이 밀린다).
  findDetailTargets(
    threshold: number,
    limit: number,
    staleBefore: Date,
    avoidSkillTags: string[],
  ): Promise<StoredJobPosting[]>;
  saveDetail(input: SaveDetailInput): Promise<void>;
  // avoidSkillTags — findNotifiable 과 같은 계약이다. 안 걸면 기피 공고가 갭 분석
  // 카드(모델 호출)로 그대로 나간다 — "저장은 하되 알림에서만 뺀다"는 목적이
  // 알림 표면 중 하나에서만 지켜지는 사고가 난다.
  findGapCandidates(
    threshold: number,
    limit: number,
    avoidSkillTags: string[],
  ): Promise<StoredJobPosting[]>;
  saveGapAgentRunId(id: number, agentRunId: number): Promise<void>;
  // 사전 갱신 후 과거 행을 되살리는 용도다. 다른 조회와 달리 lastSeenAt 신선도
  // 조건을 걸면 안 된다 — 재파생의 목적 자체가 오래돼 조용히 방치된 행까지
  // 포함해 skillTags 를 되살리는 것이라, 신선도로 거르면 정작 손볼 대상이 빠진다.
  findAllForReprocess(): Promise<StoredJobPosting[]>;
  // 채점식(match-score.ts)을 고쳤을 때 쓴다. findScoringTargets 는 프로필이 바뀐 행만
  // 잡으므로, 산식만 바꾸면 기존 행이 옛 점수 그대로 남아 변경이 조용히 무효가 된다.
  // 표식을 지워 다음 채점이 전량을 다시 매기게 한다 — matchScore 자체는 남겨 둔다
  // (재채점이 덮어쓴다. 미리 지우면 그 사이 조회가 점수 없는 행을 보게 된다).
  clearScoringMarks(): Promise<number>;
  saveSkillTags(id: number, skillTags: string[]): Promise<void>;
  // 저장소에 "언제 마지막으로 수집했는지"를 기록하는 별도 필드가 없다 — 공고를
  // 마지막으로 본 시각(lastSeenAt) 의 최댓값이 곧 마지막 수집 성공 시각이다.
  // 자동 카드(Task 16)가 신선도 조건으로 조회가 조용히 비는 것과 수집기 장애를
  // 구분하는 각주(formatJobFeedDigest)에 쓴다.
  findLastCollectedAt(): Promise<Date | null>;
}
