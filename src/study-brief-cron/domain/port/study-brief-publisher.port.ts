import { StudyTopicVerdict } from '../../../agent/cto/domain/cto.type';
import { StudyResearchKind } from '../study-research.parser';

export const STUDY_BRIEF_PUBLISHER_PORT = Symbol('STUDY_BRIEF_PUBLISHER_PORT');

export interface PublishedStudyBrief {
  pageId: string;
  url: string;
}

export interface PublishStudyBriefInput {
  kind: StudyResearchKind;
  topic: string;
  verdict: StudyTopicVerdict;
  reportMd: string;
  sourceUrls: readonly string[];
  createdAt: Date;
}

export interface StudyBriefPublisherPort {
  publish(input: PublishStudyBriefInput): Promise<PublishedStudyBrief>;
}
