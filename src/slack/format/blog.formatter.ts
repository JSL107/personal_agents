import { BlogDraftResult } from '../../agent/blog/domain/blog.type';
import { isSafeHttpUrl, sanitizeForSlackLink } from './mrkdwn.util';

// BLOG 디스패치 결과 → Slack mrkdwn. Notion 링크는 안전한 http(s) 일 때만 노출.
// published=true 면 상태=발행 으로 보강 완료, false 면 초안만 생성(수동 발행 필요).
export const formatBlogDraft = (result: BlogDraftResult): string => {
  const lines = [
    result.published ? '🚀 *블로그 발행 완료*' : '📝 *블로그 초안 완성*',
  ];
  if (isSafeHttpUrl(result.notionUrl)) {
    const linkLabel = result.published ? '발행된 글 보기' : 'Notion 에서 검토';
    lines.push(`${linkLabel}: ${sanitizeForSlackLink(result.notionUrl)}`);
  } else {
    lines.push(
      'Notion 링크를 확인하지 못했습니다 — "블로그 초안" DB 를 확인해주세요.',
    );
  }
  lines.push(
    result.published
      ? '_상태=발행 으로 자동 게시됐습니다. 공개 뷰에서 바로 확인하세요._'
      : '_초안만 생성됐습니다. Notion 에서 상태를 직접 "발행" 으로 바꿔주세요._',
  );
  return lines.join('\n');
};
