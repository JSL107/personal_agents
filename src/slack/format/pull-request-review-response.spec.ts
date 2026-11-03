import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { formatPullRequestReviewResponse } from './pull-request-review-response';

describe('formatPullRequestReviewResponse', () => {
  it('판단 보류 이유와 파일별 코멘트 원문을 마스킹한 AI 블록에 보존한다', () => {
    const review: PullRequestReview = {
      summary: '보류',
      riskLevel: 'unknown',
      approvalRecommendation: 'undetermined',
      undeterminedReason: 'diff가 잘렸습니다. 나머지 파일을 확인해야 합니다.',
      mustFix: [],
      niceToHave: [],
      missingTests: [],
      reviewCommentDrafts: [
        {
          file: 'src/auth.ts',
          line: 23,
          body: '인증 우회 경로가 남았습니다. password=supersecret',
        },
      ],
      findings: [],
    };

    const text = formatPullRequestReviewResponse({
      prRef: 'owner/repo#4',
      prTitle: '로그인 오류 수정',
      review,
    });

    expect(text).toContain('*로그인 오류 수정 리뷰*');
    expect(text).toContain('로그인 오류 수정');
    expect(text).toContain('AI에 맡길 때 아래 내용을 복사하세요.');
    expect(text).toContain('나머지 파일을 확인해야 합니다.');
    expect(text).toContain('src/auth.ts:23');
    expect(text).toContain('인증 우회 경로가 남았습니다.');
    expect(text).toContain('password=***');
    expect(text).not.toContain('password=supersecret');
  });
});
