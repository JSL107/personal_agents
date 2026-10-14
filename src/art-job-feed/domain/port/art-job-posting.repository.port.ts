import { ArtJobListing, ResolvedArtJobImage } from '../art-job-feed.type';

export const ART_JOB_POSTING_REPOSITORY_PORT = Symbol(
  'ART_JOB_POSTING_REPOSITORY_PORT',
);

export interface MarkNotifiedInput {
  listing: ArtJobListing;
  resolved: ResolvedArtJobImage;
  // 본문 메시지 ts(게시 결과에 없으면 null)와 본문 속 번호 — 번호 이모지 리액션을 되짚는 열쇠.
  messageTs: string | null;
  digestOrder: number;
}

export interface MarkExcludedInput {
  messageTs: string;
  digestOrder: number;
}

export interface ExcludedPosting {
  company: string;
  title: string;
}

export interface ArtJobPostingRepositoryPort {
  // 장부가 비었는가 — 첫 실행 판정. 첫 실행에 목록 전체를 쏟아내지 않으려고 쓴다.
  isEmpty(): Promise<boolean>;
  findKnownSourceIds(sourceIds: string[]): Promise<Set<string>>;
  markNotified(input: MarkNotifiedInput): Promise<void>;
  markSeeded(listings: ArtJobListing[]): Promise<void>;
  // 제외된 공고의 exclusionKey(회사 + 제목) 집합.
  findExcludedKeys(): Promise<Set<string>>;
  // 본문 ts + 번호에 해당하는 공고를 제외로 표시한다. 장부에 없으면 null.
  markExcluded(input: MarkExcludedInput): Promise<ExcludedPosting | null>;
}
