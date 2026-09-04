import { isStoredDailyReviewShape } from '../../../work-reviewer/domain/prompt/daily-review.shape';
import {
  DailyReview,
  NO_DECISIONS_TEXT,
  NO_RISKS_TEXT,
} from '../../../work-reviewer/domain/work-reviewer.type';

// 직전 Work Reviewer (`/worklog`) 결과를 PM 모델에게 "어제 한 일" 컨텍스트로 보여주는 섹션.
// PM 이 오늘 plan 만들 때 "어제 끝낸 것 / 미완료 추정" 을 더 정확히 판단하게 한다 (기획서 §7.1 입력).
export const formatPreviousDailyReviewSection = ({
  review,
  endedAt,
}: {
  review: DailyReview;
  endedAt: Date;
}): string => {
  const lines: string[] = [
    `[직전 Work Reviewer 실행 (${endedAt.toISOString()}) — 어제 한 일 회고]`,
    `- 요약: ${review.summary}`,
  ];

  if (review.impact.quantitative.length > 0) {
    lines.push('- 정량 근거:');
    for (const item of review.impact.quantitative) {
      lines.push(`  - ${item}`);
    }
  }

  lines.push(`- 질적 영향: ${review.impact.qualitative}`);

  if (review.improvementBeforeAfter) {
    lines.push(
      `- 개선 전: ${review.improvementBeforeAfter.before}`,
      `- 개선 후: ${review.improvementBeforeAfter.after}`,
    );
  }

  lines.push(
    ...formatBriefingSection(
      '대표 결정사항',
      review.decisions,
      NO_DECISIONS_TEXT,
    ),
  );
  lines.push(...formatBriefingSection('위험', review.risks, NO_RISKS_TEXT));

  if (review.nextActions.length > 0) {
    lines.push('- 다음 액션 (전일 시점에 식별된):');
    for (const action of review.nextActions) {
      lines.push(`  - ${action}`);
    }
  }

  lines.push(
    `- 한 줄 성과: ${review.oneLineAchievement}`,
    '',
    '※ 위 "다음 액션" 항목 중 사용자 입력 / GitHub assigned 에 그대로 남아있는 것은 "오늘 이어가야 할 것" 으로 우선 고려한다.',
  );

  return lines.join('\n');
};

// previous output (DB 의 Json) 을 안전하게 DailyReview 로 narrow.
// shape 가 안 맞으면 null — 호출자는 "이전 worklog 없음" 으로 graceful 처리.
// 여기는 원장에 이미 적재된 과거 output 을 읽는 자리라 파서보다 느슨한 판정을 쓴다
// (isStoredDailyReviewShape) — decisions / risks 도입 전 회고에는 두 키가 없기 때문이다.
// 누락은 채우지 않고 undefined 로 남긴다. 포매터가 그것을 "미검토" 로 구분해 렌더한다.
export const coerceToDailyReview = (value: unknown): DailyReview | null =>
  isStoredDailyReviewShape(value) ? value : null;

// 세 상태를 다르게 말한다 — 안건이 있으면 나열, 빈 배열이면 명시적 부정 한 줄,
// 미검토(두 필드 도입 전 회고)면 아무 줄도 쓰지 않는다.
// 미검토를 "없음" 으로 적으면 PM 이 안 본 것을 없다고 읽어 오늘 계획에서 통째로 빠뜨린다.
const formatBriefingSection = (
  label: string,
  items: string[] | undefined,
  emptyText: string,
): string[] => {
  if (items === undefined) {
    return [];
  }
  if (items.length === 0) {
    return [`- ${label}: ${emptyText}`];
  }
  return [`- ${label}:`, ...items.map((item) => `  - ${item}`)];
};
