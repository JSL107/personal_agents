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
  // 목록 행 `.info` 의 표기 그대로(예: '경력3년↑', '정규직', '경기 > 성남시'). 없으면 null.
  career: string | null;
  employmentType: string | null;
  location: string | null;
}

export interface ArtJobListResult {
  // 원시 수신 행 수. 파싱에서 걸러진 행까지 포함한다 — "수신은 있는데 파싱 0" 이
  // 사이트 구조 변경 신호라 둘을 구분해야 한다.
  received: number;
  listings: ArtJobListing[];
}

// 회사 사진은 쓰지 않는다 — 실측(2026-10-13)에서 사무실·로고 사진이라 게임 그림체를 보여주지 못했다.
// KAKAO_IMAGE 는 플레이스토어에 없는 (미출시) 게임용 — 검색 결과라 공식 이미지가 아니므로 출처를 함께 싣는다.
// 확인 못 한 검색 1순위 그림(미리보기)은 싣지 않는다 — 실측(2026-10-15)에서 '회사명 게임' 검색 1순위가
// 대표 인물·사옥 간판·순위표·다른 게임 화면이었다. 확인 못 한 공고는 구글 검색 링크만 준다.
export type ArtJobImageOrigin = 'PLAY_STORE' | 'KAKAO_IMAGE';

export interface ArtJobImage {
  url: string;
  origin: ArtJobImageOrigin;
  // 검색 결과 이미지의 출처 사이트명(예: '인벤'). 플레이스토어 아이콘은 없다.
  sourceName?: string;
}

export interface ResolvedArtJobImage {
  // 제목 [대괄호] 에서 뽑은 게임명. 회사명·미공개 프로젝트면 null.
  gameTitle: string | null;
  // 그 게임이 맞다고 확인된 그림(플레이스토어 일치·기사 제목 확인).
  image: ArtJobImage | null;
  // image 가 null 일 때 구글 이미지 검색 링크.
  googleSearchUrl: string | null;
}

export interface DownloadedImage {
  buffer: Buffer;
  filename: string;
}
