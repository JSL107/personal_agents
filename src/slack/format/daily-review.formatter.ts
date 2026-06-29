import { DailyReview } from '../../agent/work-reviewer/domain/work-reviewer.type';
import { FormattedReport } from './formatted-report.type';

// /worklog 결과 — DailyReview 를 summary(헤드라인+핵심) / detail(전체 섹션) 로 분리 렌더.
export const formatDailyReview = (review: DailyReview): FormattedReport => {
  const summaryLines: string[] = [
    '*오늘 한 일*',
    review.summary,
    '',
    `*한 줄 성과*: ${review.oneLineAchievement}`,
  ];

  const detailLines: string[] = [];

  if (review.impact.quantitative.length > 0) {
    detailLines.push(
      '*정량 근거*',
      ...review.impact.quantitative.map((item) => `• ${item}`),
      '',
    );
  }

  detailLines.push('*질적 영향*', review.impact.qualitative, '');

  if (review.improvementBeforeAfter) {
    detailLines.push(
      '*개선 전/후*',
      `• Before: ${review.improvementBeforeAfter.before}`,
      `• After: ${review.improvementBeforeAfter.after}`,
      '',
    );
  }

  if (review.nextActions.length > 0) {
    detailLines.push(
      '*다음 액션*',
      ...review.nextActions.map((action) => `• ${action}`),
      '',
    );
  }

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.join('\n'),
  };
};
