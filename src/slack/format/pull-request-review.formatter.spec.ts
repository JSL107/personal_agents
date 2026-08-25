import {
  PullRequestReview,
  ReviewFinding,
} from '../../agent/code-reviewer/domain/code-reviewer.type';
import { formatPullRequestReview } from './pull-request-review.formatter';

const NO_FINDING_NOTICE = '*지적 사항 없음*';

const baseReview = (): PullRequestReview => ({
  summary: '변경 요약',
  riskLevel: 'low',
  mustFix: [],
  niceToHave: [],
  missingTests: [],
  reviewCommentDrafts: [],
  approvalRecommendation: 'approve',
  findings: [],
});

const finding = (body: string): ReviewFinding => ({
  category: 'CORRECTNESS',
  severity: 'MUST_FIX',
  file: 'src/a.ts',
  line: 10,
  body,
});

describe('formatPullRequestReview', () => {
  it('지적이 하나도 없으면 지적 없음을 명시한다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: baseReview(),
    });

    expect(text).toContain(NO_FINDING_NOTICE);
  });

  // 판정은 다섯 목록의 AND 라 어느 하나만 빠져도 무증상으로 통과한다 — 목록별로 건다.
  it.each([
    ['mustFix', { mustFix: ['널 검사 누락'] }],
    ['niceToHave', { niceToHave: ['네이밍 정리'] }],
    ['missingTests', { missingTests: ['만료 경로 테스트'] }],
    [
      'reviewCommentDrafts',
      { reviewCommentDrafts: [{ file: 'src/a.ts', line: 10, body: '초안' }] },
    ],
    ['findings', { findings: [finding('널 검사 누락')] }],
  ])('%s 가 비어있지 않으면 지적 없음을 붙이지 않는다', (_label, override) => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: { ...baseReview(), ...override },
    });

    expect(text).not.toContain(NO_FINDING_NOTICE);
  });

  it('findings 만 있고 화면에 렌더될 목록이 비어도 지적 없음을 단언하지 않는다', () => {
    // 이 응답은 게시 경로에서 GitHub 인라인 지적으로 나간다 — 카드가 "없음"이라 하면 정반대가 된다.
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: { ...baseReview(), findings: [finding('널 검사 누락')] },
    });

    expect(text).not.toContain(NO_FINDING_NOTICE);
    expect(text).toContain('변경 요약');
  });
});
