import { PlainDate } from '../../../agent/vacation/domain/plain-date';
import {
  ArtJobListing,
  ArtJobSourceId,
  ResolvedArtJobImage,
} from '../art-job-feed.type';

export const ART_JOB_POSTING_REPOSITORY_PORT = Symbol(
  'ART_JOB_POSTING_REPOSITORY_PORT',
);

// 장부의 한 공고 — 공고 번호는 소스마다 따로 매겨지므로 소스와 번호의 쌍이 열쇠다.
export interface ArtJobPostingRef {
  source: ArtJobSourceId;
  sourceId: string;
}

// 공고 열쇠의 글 표기 — 회차 안 중복 판정과 본문 버튼 값·block_id 에 쓴다. 게임잡은 번호만 쓴다:
// 사람인을 붙이기 전에 게시된 본문의 버튼 값이 번호뿐이라, 그 버튼이 계속 게임잡 공고를 가리켜야 한다.
// 게임잡 번호(GI_No)는 숫자라 ':' 가 들어간 다른 소스 표기와 겹치지 않는다.
export const listingKey = ({ source, sourceId }: ArtJobPostingRef): string => {
  return source === 'gamejob' ? sourceId : `${source}:${sourceId}`;
};

const NON_GAMEJOB_SOURCES: readonly ArtJobSourceId[] = ['saramin'];

// listingKey 의 역. 모르는 소스 접두사면 null.
export const parseListingKey = (key: string): ArtJobPostingRef | null => {
  const separator = key.indexOf(':');
  if (separator === -1) {
    return key ? { source: 'gamejob', sourceId: key } : null;
  }
  const source = NON_GAMEJOB_SOURCES.find((candidate) => {
    return candidate === key.slice(0, separator);
  });
  const sourceId = key.slice(separator + 1);
  return source && sourceId ? { source, sourceId } : null;
};

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
  // 장부에 이미 있는 공고의 listingKey 집합.
  findKnownKeys(listings: ArtJobListing[]): Promise<Set<string>>;
  markNotified(input: MarkNotifiedInput): Promise<void>;
  markSeeded(listings: ArtJobListing[]): Promise<void>;
  // 제외된 공고의 exclusionKey(회사 + 제목) 집합.
  findExcludedKeys(): Promise<Set<string>>;
  // 주어진 공고 중 제외된 것의 listingKey. 본문 버튼을 장부 상태대로 다시 그릴 때 쓴다.
  findExcludedListingKeys(refs: ArtJobPostingRef[]): Promise<Set<string>>;
  // 제외 여부를 바꾼다. 되돌리기는 같은 회사 + 제목의 제외를 전부 푼다. 장부에 없는 공고면 false.
  setExcluded(ref: ArtJobPostingRef, excluded: boolean): Promise<boolean>;
  // 주어진 공고 중 「관심 있음」인 것의 listingKey.
  findInterestedListingKeys(refs: ArtJobPostingRef[]): Promise<Set<string>>;
  // 관심 여부와 누른 사람을 바꾸고 그 공고의 마감일을 돌려준다. 해제하면 누른 사람도 비운다.
  // 장부에 없는 공고면 null.
  setInterested(
    ref: ArtJobPostingRef,
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
