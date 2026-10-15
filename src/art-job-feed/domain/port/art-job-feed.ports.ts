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
  // 상세 본문 iframe 의 가시 텍스트. 스타일 키워드 태그에만 사용한다.
  fetchPostingBody(listing: ArtJobListing): Promise<string>;
  // 공고 상세 → 회사 정보의 「대표게임」 이름들. 회사 정보나 대표게임이 없으면 빈 배열.
  fetchRepresentativeGames(listing: ArtJobListing): Promise<string[]>;
}

export interface GameImageResolverPort {
  // 제목 게임명(플레이스토어 → 카카오 기사 확인) → 회사 대표게임(같은 순서) → 구글 검색 링크. 네트워크 실패는 던지지 않고
  // 다음 단계로 넘어간다 — 이미지 하나 때문에 공고 발송이 막히면 안 된다.
  resolve(listing: ArtJobListing): Promise<ResolvedArtJobImage>;
}

export interface ImageDownloaderPort {
  // 이미지가 아니거나(content-type) 상한을 넘으면 던진다.
  download(url: string): Promise<DownloadedImage>;
}
