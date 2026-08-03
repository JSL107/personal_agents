import { BlogDraftResult } from '../../agent/blog/domain/blog.type';
import {
  escapeSlackMrkdwn,
  isSafeHttpUrl,
  sanitizeForSlackLink,
} from './mrkdwn.util';

// Notion API 에러는 JSON 덩어리로 길게 온다 — Slack 한 줄에 담기게 자른다.
const PUBLISH_ERROR_MAX_LENGTH = 200;

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
  if (result.published) {
    lines.push(
      '_상태=발행 으로 자동 게시됐습니다. 공개 뷰에서 바로 확인하세요._',
    );
  } else if (result.publishError) {
    // 실패를 "초안만 생성됨" 으로 뭉뚱그리면 정상 동작으로 읽힌다 — 이유를 그대로 노출한다.
    // Notion API 에러는 JSON 덩어리로 길게 오므로 자르고, `<`/`&` 는 Slack 이 태그로
    // 오인해 문장이 통째로 사라지므로 escape 한다.
    const reason = escapeSlackMrkdwn(
      result.publishError.length > PUBLISH_ERROR_MAX_LENGTH
        ? `${result.publishError.slice(0, PUBLISH_ERROR_MAX_LENGTH)}…`
        : result.publishError,
    );
    lines.push(
      `⚠️ _발행 상태 전환에 실패했습니다. Notion 에서 상태를 직접 "발행" 으로 바꿔주세요 — ${reason}_`,
    );
  } else {
    lines.push(
      '_초안만 생성됐습니다. Notion 에서 상태를 직접 "발행" 으로 바꿔주세요._',
    );
  }
  return lines.join('\n');
};
