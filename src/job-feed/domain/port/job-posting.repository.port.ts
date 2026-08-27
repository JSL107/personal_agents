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
  findNotifiable(threshold: number, limit: number): Promise<StoredJobPosting[]>;
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
}
