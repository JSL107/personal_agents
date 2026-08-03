export interface GenerateBlogDraftInput {
  requestText: string;
  slackUserId: string;
}

// Hermes 실행 결과에서 추출한 초안 정보.
export interface BlogDraftResult {
  notionUrl: string;
  // Hermes stdout 최종 블록(요약/제목 등) — 포맷터/디버깅에 사용.
  rawOutput: string;
  // Notion 페이지를 발행 상태(상태=발행 등)로 enrich 성공했는지. 실패해도 초안 URL 은 회신.
  published: boolean;
  /**
   * `published === false` 인 **이유**. 발행을 시도했다가 실패한 경우에만 채워진다.
   *
   * 이게 없으면 "속성 갱신이 실패했다" 와 "발행할 대상 자체가 없었다" 가 똑같이
   * `published: false` 로 보여서, 사용자에게는 정상 초안 생성처럼 읽힌다. 실측
   * (2026-06) BLOG 성공 4건이 전부 `published: false` 였는데 warn 로그로만 남아
   * 아무도 실패인 줄 몰랐다 — 저녁 경로가 #153 에서 같은 이유로 고친 것과 같은 처리.
   */
  publishError?: string;
}
