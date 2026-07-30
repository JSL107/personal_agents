import { DailyReview } from '../../agent/work-reviewer/domain/work-reviewer.type';
import { FormattedReport } from './formatted-report.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// /worklog 결과 — DailyReview 를 summary(헤드라인+핵심) / detail(전체 섹션) 로 분리 렌더.
// 모든 필드가 LLM 자유텍스트라 mrkdwn control 문자 escape (메시지 위조·잘림 방지).
export const formatDailyReview = (review: DailyReview): FormattedReport => {
  const summaryLines: string[] = [
    '*오늘 한 일*',
    escapeSlackMrkdwn(review.summary),
    '',
    `*한 줄 성과*: ${escapeSlackMrkdwn(review.oneLineAchievement)}`,
  ];

  const detailLines: string[] = [];

  if (review.impact.quantitative.length > 0) {
    detailLines.push(
      '*정량 근거*',
      ...review.impact.quantitative.map(
        (item) => `• ${escapeSlackMrkdwn(item)}`,
      ),
      '',
    );
  }

  detailLines.push(
    '*질적 영향*',
    escapeSlackMrkdwn(review.impact.qualitative),
    '',
  );

  if (review.improvementBeforeAfter) {
    detailLines.push(
      '*개선 전/후*',
      `• Before: ${escapeSlackMrkdwn(review.improvementBeforeAfter.before)}`,
      `• After: ${escapeSlackMrkdwn(review.improvementBeforeAfter.after)}`,
      '',
    );
  }

  if (review.nextActions.length > 0) {
    detailLines.push(
      '*다음 액션*',
      ...review.nextActions.map((action) => `• ${escapeSlackMrkdwn(action)}`),
      '',
    );
  }

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.join('\n'),
  };
};
