import {
  DailyReview,
  NO_DECISIONS_TEXT,
  NO_RISKS_TEXT,
} from '../../agent/work-reviewer/domain/work-reviewer.type';
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

  // 결정사항·위험은 비어도 섹션을 지우지 않는다. 섹션이 사라지면 "결재할 것이 없었다" 와
  // "회고가 그 축을 아예 안 봤다" 가 화면에서 똑같아 보인다.
  detailLines.push(
    ...formatBriefingSection(
      '대표 결정사항',
      review.decisions,
      NO_DECISIONS_TEXT,
    ),
    ...formatBriefingSection('위험', review.risks, NO_RISKS_TEXT),
  );

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

const formatBriefingSection = (
  label: string,
  items: string[],
  emptyText: string,
): string[] => {
  if (items.length === 0) {
    return [`*${label}*`, emptyText, ''];
  }
  return [
    `*${label}*`,
    ...items.map((item) => `• ${escapeSlackMrkdwn(item)}`),
    '',
  ];
};
