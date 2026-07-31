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
    // mustFix/niceToHave/missingTests 를 legacy 변환했을 때 나오는 값과 동일하게 채운다.
    // findings 를 빈 배열로 두면 파서가 "findings 비어 있음 → legacy 폴백"으로 다시
    // 이 3배열에서 파생시키므로, round-trip(toEqual) 이 성립하려면 여기도 일치시켜야 한다.
    findings: [
      {
        category: 'UNCLASSIFIED',
        severity: 'MUST_FIX',
        body: '에러 핸들링에서 token 마스킹 필요',
      },
      {
        category: 'UNCLASSIFIED',
        severity: 'NICE_TO_HAVE',
        body: 'env allowlist 주석 보강',
      },
      {
        category: 'UNCLASSIFIED',
        severity: 'MISSING_TEST',
        body: 'paginate truncated 케이스',
      },
    ],
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

  it('findings 가 빈 배열이면(모델이 필드만 비워 보낸 경우) legacy 3배열에서 파생한다', () => {
    // 회귀 방지: Array.isArray([]) 는 true 이므로 "findings 존재 여부"만으로 분기하면
    // 모델이 findings: [] 를 내고 mustFix 등은 채운 경우 그 값이 조용히 유실된다.
    const text = JSON.stringify({ ...baseResponse, findings: [] });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings).toEqual([
      { category: 'UNCLASSIFIED', severity: 'MUST_FIX', body: '트랜잭션 누락' },
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

  it('findings 요소의 line 이 정수가 아니거나 0 이하면 생략한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [
        { category: 'STYLE', severity: 'MUST_FIX', body: '소수', line: 1.5 },
        { category: 'STYLE', severity: 'MUST_FIX', body: '영', line: 0 },
        { category: 'STYLE', severity: 'MUST_FIX', body: '음수', line: -3 },
      ],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings.map((finding) => finding.line)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('findings 요소의 line 이 1 이상 정수면 유지한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [
        { category: 'STYLE', severity: 'MUST_FIX', body: '본문', line: 12 },
      ],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings[0].line).toBe(12);
  });

  it('findings 요소의 body 앞뒤 공백을 제거하고 저장한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [
        { category: 'STYLE', severity: 'NICE_TO_HAVE', body: '  본문 공백  ' },
      ],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings[0].body).toBe('본문 공백');
  });
});
