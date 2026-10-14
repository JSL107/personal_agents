import {
  ArtJobListing,
  ArtJobListResult,
  ArtJobSourceId,
  DownloadedImage,
  ResolvedArtJobImage,
} from '../art-job-feed.type';

// 여러 소스를 한 모듈(ArtJobFeedModule)에서 배열로 중앙 등록한다.
export const ART_JOB_SOURCES = Symbol('ART_JOB_SOURCES');
export const GAME_IMAGE_RESOLVER_PORT = Symbol('GAME_IMAGE_RESOLVER_PORT');
export const IMAGE_DOWNLOADER_PORT = Symbol('IMAGE_DOWNLOADER_PORT');

export interface ArtJobSourcePort {
  readonly source: ArtJobSourceId;
  // 원화 직종 목록, 등록일 최신순. page 는 1부터.
  fetchLatest(page: number): Promise<ArtJobListResult>;
  // 상세 본문의 가시 텍스트. 스타일 키워드 태그에만 사용한다. 본문을 받을 수 없는 소스는 빈 문자열.
  fetchPostingBody(listing: ArtJobListing): Promise<string>;
  // 공고 상세 → 회사 정보의 「대표게임」 이름들. 회사 정보나 대표게임이 없으면(그런 정보가 없는 소스 포함) 빈 배열.
  fetchRepresentativeGames(listing: ArtJobListing): Promise<string[]>;
}

// 공고를 가져온 소스. 공고 번호는 그 소스에서만 뜻이 있으므로 상세 조회는 반드시 이 소스로 한다.
export const sourceOf = (
  sources: readonly ArtJobSourcePort[],
  listing: ArtJobListing,
): ArtJobSourcePort => {
  const found = sources.find((source) => source.source === listing.source);
  if (!found) {
    throw new Error(`등록되지 않은 원화 공고 소스 — ${listing.source}`);
  }
  return found;
};

export interface GameImageResolverPort {
  // 제목 게임명(플레이스토어 → 카카오 기사 확인) → 회사 대표게임(같은 순서) → 구글 검색 링크. 네트워크 실패는 던지지 않고
  // 다음 단계로 넘어간다 — 이미지 하나 때문에 공고 발송이 막히면 안 된다.
  resolve(listing: ArtJobListing): Promise<ResolvedArtJobImage>;
}

export interface ImageDownloaderPort {
  // 이미지가 아니거나(content-type) 상한을 넘으면 던진다.
  download(url: string): Promise<DownloadedImage>;
}
