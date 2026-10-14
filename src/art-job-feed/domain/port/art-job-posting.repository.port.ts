import { ArtJobListing, ResolvedArtJobImage } from '../art-job-feed.type';

export const ART_JOB_POSTING_REPOSITORY_PORT = Symbol(
  'ART_JOB_POSTING_REPOSITORY_PORT',
);

export interface MarkNotifiedInput {
  listing: ArtJobListing;
  resolved: ResolvedArtJobImage;
}

export interface ArtJobPostingRepositoryPort {
  // 장부가 비었는가 — 첫 실행 판정. 첫 실행에 목록 전체를 쏟아내지 않으려고 쓴다.
  isEmpty(): Promise<boolean>;
  findKnownSourceIds(sourceIds: string[]): Promise<Set<string>>;
  markNotified(input: MarkNotifiedInput): Promise<void>;
  markSeeded(listings: ArtJobListing[]): Promise<void>;
  // 제외된 공고의 exclusionKey(회사 + 제목) 집합.
  findExcludedKeys(): Promise<Set<string>>;
  // 주어진 공고 중 제외된 것의 sourceId. 본문 버튼을 장부 상태대로 다시 그릴 때 쓴다.
  findExcludedSourceIds(sourceIds: string[]): Promise<Set<string>>;
  // 제외 여부를 바꾼다. 되돌리기는 같은 회사 + 제목의 제외를 전부 푼다. 장부에 없는 공고면 false.
  setExcluded(sourceId: string, excluded: boolean): Promise<boolean>;
}
