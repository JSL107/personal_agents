import { CareerProfileData } from '../career-mate.type';

export const CAREER_PROFILE_REPOSITORY_PORT = Symbol(
  'CAREER_PROFILE_REPOSITORY_PORT',
);

export interface SaveCareerProfileInput {
  agentRunId: number;
  slackUserId: string;
  githubLogin: string;
  windowStart: string; // YYYY-MM-DD
  prCount: number;
  summary: string;
  profileJson: CareerProfileData;
}

export interface CareerProfileSnapshot {
  id: number;
  agentRunId: number | null;
  profileJson: CareerProfileData;
  createdAt: Date;
}

export interface CareerProfileRepositoryPort {
  save(input: SaveCareerProfileInput): Promise<{ id: number }>;
  findLatestBySlackUser(
    slackUserId: string,
  ): Promise<CareerProfileSnapshot | null>;
}
