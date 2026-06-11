// Hermes stdout 에서 생성된 Notion 페이지 URL 을 추출한다.
// 1순위: `NOTION_URL: <url>` 마커(프롬프트가 요청한 형식) 중 마지막 것.
// 2순위: 본문에 등장하는 마지막 notion 도메인 URL.
// 못 찾으면 null.
const MARKER_REGEX = /NOTION_URL:\s*(https?:\/\/[^\s)]+)/gi;
const NOTION_URL_REGEX =
  /https?:\/\/(?:www\.|app\.)?notion\.(?:so|com)\/[^\s)]+/gi;

export const extractNotionUrl = (stdout: string): string | null => {
  const markers = [...stdout.matchAll(MARKER_REGEX)];
  if (markers.length > 0) {
    return markers[markers.length - 1][1];
  }
  const urls = stdout.match(NOTION_URL_REGEX);
  if (urls && urls.length > 0) {
    return urls[urls.length - 1];
  }
  return null;
};
