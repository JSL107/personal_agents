import { StudyBriefVerdict } from '../study-brief.type';
import { StudyResearchKind } from '../study-research.parser';

export const STUDY_BRIEF_PUBLISHER_PORT = Symbol('STUDY_BRIEF_PUBLISHER_PORT');

export interface PublishedStudyBrief {
  pageId: string;
  url: string;
}

export interface PublishStudyBriefInput {
  kind: StudyResearchKind;
  topic: string;
  verdict: StudyBriefVerdict;
  reportMd: string;
  sourceUrls: readonly string[];
  createdAt: Date;
  // 그림 첨부는 선택이다. 값이 없으면 그림 없이 발행한다 — 그림 유무가 발행 성패를 가르지 않는다.
  diagramFileUploadId?: string;
}

export interface StudyBriefPublisherPort {
  publish(input: PublishStudyBriefInput): Promise<PublishedStudyBrief>;
}
