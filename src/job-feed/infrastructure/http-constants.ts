export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Node 의 fetch 에는 기본 타임아웃이 없다. 지정하지 않으면 응답이 없을 때 무한정 매달린다.
export const LIST_REQUEST_TIMEOUT_MS = 15_000;
export const DETAIL_REQUEST_TIMEOUT_MS = 8_000;

// 대상 서버에 무리를 주지 않기 위한 요청 간 고정 지연 (CODE_RULES §12).
export const DETAIL_REQUEST_DELAY_MS = 500;

export const JSON_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': BROWSER_USER_AGENT,
  Accept: 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};
