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
}
