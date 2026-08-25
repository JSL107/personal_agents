import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { formatPullRequestReview } from './pull-request-review.formatter';

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

describe('formatPullRequestReview', () => {
  it('지적이 하나도 없으면 지적 없음을 명시한다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: baseReview(),
    });

    expect(text).toContain('*지적 사항 없음*');
  });

  it('지적이 하나라도 있으면 지적 없음을 붙이지 않는다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: { ...baseReview(), niceToHave: ['네이밍 정리'] },
    });

    expect(text).not.toContain('*지적 사항 없음*');
    expect(text).toContain('네이밍 정리');
  });
});
