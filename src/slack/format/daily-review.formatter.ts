import { DailyReview } from '../../agent/work-reviewer/domain/work-reviewer.type';

// /worklog 결과 — DailyReview 를 한국어 Slack 마크다운으로 렌더.
export const formatDailyReview = (review: DailyReview): string => {
  const lines: string[] = ['*오늘 한 일*', review.summary, ''];

  if (review.impact.quantitative.length > 0) {
    lines.push(
      '*정량 근거*',
      ...review.impact.quantitative.map((item) => `• ${item}`),
      '',
    );
  }

  lines.push('*질적 영향*', review.impact.qualitative, '');

  if (review.improvementBeforeAfter) {
    lines.push(
      '*개선 전/후*',
      `• Before: ${review.improvementBeforeAfter.before}`,
      `• After: ${review.improvementBeforeAfter.after}`,
      '',
    );
  }

  if (review.nextActions.length > 0) {
    lines.push(
      '*다음 액션*',
      ...review.nextActions.map((action) => `• ${action}`),
      '',
    );
  }

  lines.push(`*한 줄 성과*: ${review.oneLineAchievement}`);

  return lines.join('\n');
};
