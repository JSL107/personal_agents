import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

export const IDAERI_REVIEW_MARKER = '🤖 **이대리 자동 리뷰**';

export interface BuildFindingCommentBodyInput {
  category: FindingCategory;
  severity: FindingSeverity;
  body: string;
}

export const buildFindingCommentBody = ({
  category,
  severity,
  body,
}: BuildFindingCommentBodyInput): string =>
  `${IDAERI_REVIEW_MARKER} · ${category} / ${severity}\n\n${body.trim()}`;

// 지적 0건으로 끝난 스윕 리뷰가 PR 에 남기는 코멘트.
//
// 지적 카드가 아니므로 pr_review_finding 에 적재하지 않는다 — 수확기는 저장된 카드의
// commentId 로 스레드를 찾으므로(harvest-signal.ts:30-33) 이 코멘트는 애초에 판정 대상이
// 아니고, 마커로 시작해 같은 스레드의 답글 필터에서도 자기 글로 걸러진다(같은 파일 44).
//
// 요약은 한 줄로 눌러 인용한다. 모델이 줄바꿈을 섞으면 두 번째 줄부터 인용 밖으로 나가
// 코멘트가 두 문단으로 갈라진다. 스키마 검사는 summary 가 문자열이기만 하면 통과시키므로
// (pr-review.parser.ts:81) 빈 값이 올 수 있다 — 그때는 인용 줄째로 뺀다.
export const buildNoFindingsCommentBody = (summary: string): string => {
  const flattened = summary.trim().replace(/\s*\n+\s*/g, ' ');
  const quoted = flattened.length > 0 ? `\n\n> ${flattened}` : '';
  return `${IDAERI_REVIEW_MARKER} · 지적 사항 없음\n\n이번 diff 에서 머지 전에 고쳐야 할 것을 찾지 못했습니다.${quoted}`;
};
