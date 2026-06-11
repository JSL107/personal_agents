// BLOG 에이전트 도메인 에러코드.
// enum VALUE 는 `BLOG_` prefix — common/exception/response-code.enum.ts 의 ResponseCode 와
// 1:1 문자열 매칭 (AllExceptionsFilter 가 도메인 코드를 ResponseCode 에서 매칭).
export enum BlogErrorCode {
  EMPTY_REQUEST = 'BLOG_EMPTY_REQUEST',
  HERMES_SPAWN_FAILED = 'BLOG_HERMES_SPAWN_FAILED',
  HERMES_TIMEOUT = 'BLOG_HERMES_TIMEOUT',
  HERMES_NONZERO_EXIT = 'BLOG_HERMES_NONZERO_EXIT',
  NOTION_URL_NOT_FOUND = 'BLOG_NOTION_URL_NOT_FOUND',
}
