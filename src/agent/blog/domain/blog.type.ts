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
}
