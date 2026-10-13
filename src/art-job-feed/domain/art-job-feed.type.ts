// 게임잡 원화 공고 피드 — 백엔드 피드(src/job-feed)와 분리한다. 백엔드 쪽은 내 커리어
// 프로필로 채점해 고르는 구조이고, 이쪽은 남(디자이너)에게 조건에 맞는 공고를 전부 보낸다.
export const ART_JOB_SOURCE = 'gamejob';

// 목록 한 행에서 뽑는 값.
export interface ArtJobListing {
  sourceId: string;
  company: string;
  title: string;
  detailUrl: string;
  // 목록 표기 그대로(예: '채용시', 'D-12', '~10/31(금)'). 못 찾으면 null.
  deadlineText: string | null;
}

export interface ArtJobListResult {
  // 원시 수신 행 수. 파싱에서 걸러진 행까지 포함한다 — "수신은 있는데 파싱 0" 이
  // 사이트 구조 변경 신호라 둘을 구분해야 한다.
  received: number;
  listings: ArtJobListing[];
}

export type ArtJobImageOrigin = 'PLAY_STORE' | 'COMPANY_PHOTO';

export interface ArtJobImage {
  url: string;
  origin: ArtJobImageOrigin;
}

export interface ResolvedArtJobImage {
  // 제목 [대괄호] 에서 뽑은 게임명. 회사명·미공개 프로젝트면 null.
  gameTitle: string | null;
  image: ArtJobImage | null;
  // image 가 null 일 때만 채운다 — 구글 이미지 검색 링크.
  googleSearchUrl: string | null;
}

export interface DownloadedImage {
  buffer: Buffer;
  filename: string;
}
