import { PullRequestReview } from './code-reviewer.type';
import { hasNoReviewFindings } from './review-emptiness';

const EMPTY: PullRequestReview = {
  summary: '요약',
  riskLevel: 'low',
  mustFix: [],
  niceToHave: [],
  missingTests: [],
  reviewCommentDrafts: [],
  approvalRecommendation: 'approve',
  findings: [],
};

describe('hasNoReviewFindings', () => {
  it('다섯 목록이 모두 비면 지적 없음이다', () => {
    expect(hasNoReviewFindings(EMPTY)).toBe(true);
  });

  // 목록 하나만 채운 케이스를 각각 건다 — 판정이 AND 라 조건 하나를 잃어도 나머지
  // 테스트는 그대로 통과해 무증상이 된다.
  it.each<[string, Partial<PullRequestReview>]>([
    ['mustFix', { mustFix: ['머지 전 수정'] }],
    ['niceToHave', { niceToHave: ['후속 개선'] }],
    ['missingTests', { missingTests: ['테스트 누락'] }],
    [
      'reviewCommentDrafts',
      { reviewCommentDrafts: [{ body: '이 줄을 보세요' }] },
    ],
    [
      'findings',
      {
        findings: [
          {
            category: 'CORRECTNESS' as const,
            severity: 'MUST_FIX' as const,
            body: '경계 조건',
          },
        ],
      },
    ],
  ])('%s 만 차 있어도 지적 없음이 아니다', (_label, filled) => {
    expect(hasNoReviewFindings({ ...EMPTY, ...filled })).toBe(false);
  });
});
