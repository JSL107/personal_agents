import { PlainDate } from '../../../agent/vacation/domain/plain-date';
import { ArtJobListing, ResolvedArtJobImage } from '../art-job-feed.type';

export const ART_JOB_POSTING_REPOSITORY_PORT = Symbol(
  'ART_JOB_POSTING_REPOSITORY_PORT',
);

export interface MarkNotifiedInput {
  listing: ArtJobListing;
  resolved: ResolvedArtJobImage;
  deadlineDate: PlainDate | null;
}

export interface InterestedPosting {
  deadlineDate: PlainDate | null;
}

export interface ArtJobReminderPosting {
  id: number;
  company: string;
  title: string;
  detailUrl: string;
  // 「관심 있음」을 누른 사람. 이 컬럼이 생기기 전에 표시된 공고는 null.
  interestedBy: string | null;
}

export interface ArtJobPostingRepositoryPort {
  // 장부가 비었는가 — 첫 실행 판정. 첫 실행에 목록 전체를 쏟아내지 않으려고 쓴다.
  isEmpty(): Promise<boolean>;
  // 이미 보낸 공고의 sourceId. 첫 실행에서 보류만 한 공고(markSeeded)는 빠진다 — 다음 회차들이 상한 안에서 보낸다.
  findKnownSourceIds(sourceIds: string[]): Promise<Set<string>>;
  markNotified(input: MarkNotifiedInput): Promise<void>;
  markSeeded(listings: ArtJobListing[]): Promise<void>;
  // 제외된 공고의 exclusionKey(회사 + 제목) 집합.
  findExcludedKeys(): Promise<Set<string>>;
  // 주어진 공고 중 제외된 것의 sourceId. 본문 버튼을 장부 상태대로 다시 그릴 때 쓴다.
  findExcludedSourceIds(sourceIds: string[]): Promise<Set<string>>;
  // 제외 여부를 바꾼다. 되돌리기는 같은 회사 + 제목의 제외를 전부 푼다. 장부에 없는 공고면 false.
  setExcluded(sourceId: string, excluded: boolean): Promise<boolean>;
  // 주어진 공고 중 「관심 있음」인 것의 sourceId.
  findInterestedSourceIds(sourceIds: string[]): Promise<Set<string>>;
  // 관심 여부와 누른 사람을 바꾸고 그 공고의 마감일을 돌려준다. 해제하면 누른 사람도 비운다.
  // 장부에 없는 공고면 null.
  setInterested(
    sourceId: string,
    interested: boolean,
    userId: string,
  ): Promise<InterestedPosting | null>;
  // 마감일이 deadline 인 관심 공고 중, 제외되지 않았고 remindedBefore 이후로 알림을 안 보낸 것.
  findDueReminders(
    deadline: PlainDate,
    remindedBefore: Date,
  ): Promise<ArtJobReminderPosting[]>;
  markReminded(ids: number[], at: Date): Promise<void>;
}
