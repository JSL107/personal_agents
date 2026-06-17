// Hermes stdout 에서 블로그 메타(TAGS/SUMMARY 마커)와 Notion page id 를 추출한다.
// build-blog-prompt 가 `TAGS: ...` / `SUMMARY: ...` 라인 출력을 요청한다. 없으면 빈/null (graceful).
const TAGS_REGEX = /TAGS:\s*(.+)/i;
const SUMMARY_REGEX = /SUMMARY:\s*(.+)/i;
const MAX_TAGS = 5;

export const extractTags = (stdout: string): string[] => {
  const matched = stdout.match(TAGS_REGEX);
  if (!matched) {
    return [];
  }
  return matched[1]
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, MAX_TAGS);
};

export const extractSummary = (stdout: string): string | null => {
  const matched = stdout.match(SUMMARY_REGEX);
  if (!matched) {
    return null;
  }
  const summary = matched[1].trim();
  return summary.length > 0 ? summary : null;
};

// Notion URL 끝의 page id (32-hex 또는 dashed UUID) 추출. 여러 개면 마지막(id 는 URL 끝).
const PAGE_ID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/gi;

export const notionPageIdFromUrl = (url: string): string | null => {
  const matches = url.match(PAGE_ID_REGEX);
  if (!matches || matches.length === 0) {
    return null;
  }
  return matches[matches.length - 1];
};
