import { BlogDraftResult } from '../../agent/blog/domain/blog.type';
import { isSafeHttpUrl, sanitizeForSlackLink } from './mrkdwn.util';

// BLOG 디스패치 결과 → Slack mrkdwn. Notion 링크는 안전한 http(s) 일 때만 노출.
export const formatBlogDraft = (result: BlogDraftResult): string => {
  const lines = ['📝 *블로그 초안 완성*'];
  if (isSafeHttpUrl(result.notionUrl)) {
    lines.push(`Notion 에서 검토: ${sanitizeForSlackLink(result.notionUrl)}`);
  } else {
    lines.push(
      'Notion 링크를 확인하지 못했습니다 — "블로그 초안" DB 를 확인해주세요.',
    );
  }
  lines.push('_검토 후 Tistory 마크다운 에디터에 붙여넣어 발행하세요._');
  return lines.join('\n');
};
