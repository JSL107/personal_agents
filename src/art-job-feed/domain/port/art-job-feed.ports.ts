import {
  ArtJobListing,
  ArtJobListResult,
  DownloadedImage,
  ResolvedArtJobImage,
} from '../art-job-feed.type';

export const ART_JOB_SOURCE_PORT = Symbol('ART_JOB_SOURCE_PORT');
export const GAME_IMAGE_RESOLVER_PORT = Symbol('GAME_IMAGE_RESOLVER_PORT');
export const IMAGE_DOWNLOADER_PORT = Symbol('IMAGE_DOWNLOADER_PORT');

export interface ArtJobSourcePort {
  // 원화 직종 목록, 등록일 최신순. page 는 1부터.
  fetchLatest(page: number): Promise<ArtJobListResult>;
}

export interface GameImageResolverPort {
  // 플레이스토어(이름 일치) → 없으면 게임명 구글 검색 링크. 네트워크 실패는 던지지 않고
  // 다음 단계로 넘어간다 — 이미지 하나 때문에 공고 발송이 막히면 안 된다.
  resolve(listing: ArtJobListing): Promise<ResolvedArtJobImage>;
}

export interface ImageDownloaderPort {
  // 이미지가 아니거나(content-type) 상한을 넘으면 던진다.
  download(url: string): Promise<DownloadedImage>;
}
