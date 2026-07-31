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
    findings: [],
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

describe('parsePullRequestReview — findings', () => {
  const baseResponse = {
    summary: '요약',
    riskLevel: 'medium',
    mustFix: ['트랜잭션 누락'],
    niceToHave: ['변수명 개선'],
    missingTests: ['실패 케이스 테스트 없음'],
    reviewCommentDrafts: [],
    approvalRecommendation: 'request_changes',
  };

  it('findings 가 있으면 그대로 정본으로 쓴다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [
        {
          category: 'RELIABILITY',
          severity: 'MUST_FIX',
          file: 'src/foo.service.ts',
          line: 42,
          body: '트랜잭션 밖에서 저장한다',
        },
      ],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings).toEqual([
      {
        category: 'RELIABILITY',
        severity: 'MUST_FIX',
        file: 'src/foo.service.ts',
        line: 42,
        body: '트랜잭션 밖에서 저장한다',
      },
    ]);
  });

  it('findings 가 없으면 기존 3배열에서 UNCLASSIFIED 로 변환한다', () => {
    const parsed = parsePullRequestReview(JSON.stringify(baseResponse));

    expect(parsed.findings).toEqual([
      {
        category: 'UNCLASSIFIED',
        severity: 'MUST_FIX',
        body: '트랜잭션 누락',
      },
      {
        category: 'UNCLASSIFIED',
        severity: 'NICE_TO_HAVE',
        body: '변수명 개선',
      },
      {
        category: 'UNCLASSIFIED',
        severity: 'MISSING_TEST',
        body: '실패 케이스 테스트 없음',
      },
    ]);
  });

  it('findings 요소의 category 가 목록 밖이면 UNCLASSIFIED 로 강등한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [{ category: 'NONSENSE', severity: 'MUST_FIX', body: '본문' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings[0].category).toBe('UNCLASSIFIED');
  });

  it('findings 요소의 severity 가 목록 밖이면 NICE_TO_HAVE 로 강등한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [{ category: 'STYLE', severity: 'WHATEVER', body: '본문' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings[0].severity).toBe('NICE_TO_HAVE');
  });

  it('findings 요소에 body 가 없으면 그 요소를 버린다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [{ category: 'STYLE', severity: 'NICE_TO_HAVE' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings).toEqual([]);
  });
});
