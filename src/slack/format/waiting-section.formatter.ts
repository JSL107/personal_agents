import { WaitingItem } from '../../github/domain/pr-engagement.type';
import { isSafeHttpUrl, sanitizeForSlackLink } from './mrkdwn.util';

// 끝났거나 내 차례가 아닌 PR 을 "확인만" 하도록 강등 노출하는 섹션.
// formatDailyPlan 출력 뒤에 이어 붙이므로 앞에 빈 줄 2개로 분리한다. 항목 없으면 빈 문자열.
export const formatWaitingSection = (items: WaitingItem[]): string => {
  if (items.length === 0) {
    return '';
  }
  const lines = ['', '', '🕓 *대기 중 (확인만)*'];
  for (const item of items) {
    const titled =
      item.url.length > 0 && isSafeHttpUrl(item.url)
        ? `<${sanitizeForSlackLink(item.url)}|${sanitizeForSlackLink(item.title)}>`
        : item.title;
    lines.push(`• ${titled} — _${item.reason}_`);
  }
  return lines.join('\n');
};
