import { CodeReviewerException } from '../code-reviewer.exception';
import { PullRequestReview } from '../code-reviewer.type';
import { parsePullRequestReview } from './pr-review.parser';

describe('parsePullRequestReview', () => {
  const valid: PullRequestReview = {
    summary: 'GitHub 커넥터 추가, mustFix 1건',
    riskLevel: 'medium',
    mustFix: ['에러 핸들링에서 token 마스킹 필요'],
    niceToHave: ['env allowlist 주석 보강'],
    missingTests: ['paginate truncated 케이스'],
    reviewCommentDrafts: [
      {
        file: 'src/github/infrastructure/octokit-github.client.ts',
        line: 80,
        body: '여기서 error.message 에 token 이 섞일 수 있습니다.',
      },
      { body: '전반적으로 잘 짜여 있습니다.' },
    ],
    approvalRecommendation: 'request_changes',
  };

  it('JSON 문자열을 PullRequestReview 로 파싱', () => {
    expect(parsePullRequestReview(JSON.stringify(valid))).toEqual(valid);
  });

  it('```json 코드 펜스 감싼 응답도 벗겨낸 뒤 파싱', () => {
    const wrapped = ['```json', JSON.stringify(valid), '```'].join('\n');
    expect(parsePullRequestReview(wrapped)).toEqual(valid);
  });

  it('JSON 으로 파싱 불가하면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() => parsePullRequestReview('not json')).toThrow(
      CodeReviewerException,
    );
  });

  it('riskLevel 이 enum 외 값이면 예외', () => {
    const broken = { ...valid, riskLevel: 'critical' };
    expect(() => parsePullRequestReview(JSON.stringify(broken))).toThrow(
      CodeReviewerException,
    );
  });

  it('approvalRecommendation 이 enum 외 값이면 예외', () => {
    const broken = { ...valid, approvalRecommendation: 'merge' };
    expect(() => parsePullRequestReview(JSON.stringify(broken))).toThrow(
      CodeReviewerException,
    );
  });

  it('reviewCommentDrafts.body 누락 시 예외', () => {
    const broken = {
      ...valid,
      reviewCommentDrafts: [{ file: 'a.ts', line: 1 }],
    };
    expect(() => parsePullRequestReview(JSON.stringify(broken))).toThrow(
      CodeReviewerException,
    );
  });

  it('mustFix 가 string[] 가 아니면 예외', () => {
    const broken = { ...valid, mustFix: [1, 2] };
    expect(() => parsePullRequestReview(JSON.stringify(broken))).toThrow(
      CodeReviewerException,
    );
  });
});
