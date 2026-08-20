import { StudyBriefVerdict } from '../study-brief.type';
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
  verdict: StudyBriefVerdict;
  reportMd: string;
  sourceUrls: string[];
}

// 딥다이브 확장의 입력. 조사 원문과 출처를 그대로 들고 있어 Notion 을 되읽지 않아도 된다.
export interface ExpandableStudyBrief {
  id: number;
  kind: StudyResearchKind;
  topic: string;
  verdict: StudyBriefVerdict;
  reportMd: string;
  sourceUrls: string[];
  createdAt: Date;
}

export interface StudyBriefRepositoryPort {
  findRecentSince(
    ownerUserId: string,
    since: Date,
  ): Promise<RecentStudyBrief[]>;
  // 아직 블로그 초안으로 확장하지 않은 브리프 중 가장 최근 1건. 없으면 undefined.
  findLatestUnexpandedSince(
    ownerUserId: string,
    since: Date,
  ): Promise<ExpandableStudyBrief | undefined>;
  save(input: SaveStudyBriefInput): Promise<{ id: number }>;
  updateNotionUrl(id: number, notionUrl: string): Promise<void>;
  markBlogDraftCreated(id: number, blogDraftPageId: string): Promise<void>;
}
