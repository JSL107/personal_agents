import { StudyTopicVerdict } from '../../../agent/cto/domain/cto.type';
import { StudyResearchKind } from '../study-research.parser';

export const STUDY_BRIEF_REPOSITORY_PORT = Symbol(
  'STUDY_BRIEF_REPOSITORY_PORT',
);

export interface RecentStudyBrief {
  kind: StudyResearchKind;
  topic: string;
  createdAt: Date;
}

export interface SaveStudyBriefInput {
  agentRunId: number;
  ownerUserId: string;
  kind: StudyResearchKind;
  topic: string;
  verdict: StudyTopicVerdict;
  reportMd: string;
  sourceUrls: string[];
}

export interface StudyBriefRepositoryPort {
  findRecentSince(
    ownerUserId: string,
    since: Date,
  ): Promise<RecentStudyBrief[]>;
  save(input: SaveStudyBriefInput): Promise<{ id: number }>;
  updateNotionUrl(id: number, notionUrl: string): Promise<void>;
}
