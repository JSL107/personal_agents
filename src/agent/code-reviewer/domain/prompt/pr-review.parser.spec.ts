import { CodeReviewerException } from '../code-reviewer.exception';
import { PullRequestReview } from '../code-reviewer.type';
import {
  parsePullRequestReview,
  UNDETERMINED_REASON_MISSING,
  UNDETERMINED_REASON_UNKNOWN_RISK,
} from './pr-review.parser';

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

  it('JSON 파싱 실패 시 raw 응답 앞부분을 cause 에 남긴다', () => {
    // 문자열 값 안의 따옴표를 이스케이프하지 않아 뒤따르는 "a" 가 키로 읽히는 형태 —
    // 운영 실패(Expected ':' after property name)와 같은 에러를 낸다.
    const broken = '{"summary": "이 PR 은 ", "a" 를 추가"}';
    expect.assertions(1);
    try {
      parsePullRequestReview(broken);
    } catch (error: unknown) {
      const cause = (error as { cause?: unknown }).cause;
      expect(cause instanceof Error ? cause.message : '').toContain(
        `raw=${broken}`,
      );
    }
  });

  it('앞뒤 설명문이 붙은 응답도 JSON 본문만 골라 파싱', () => {
    const noisy = `리뷰 결과입니다.\n${JSON.stringify(valid)}\n이상입니다.`;
    expect(parsePullRequestReview(noisy)).toEqual(valid);
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
    // legacy 3배열을 비워 폴백을 배제한다 — 여기서 검증할 것은 "요소 탈락"만이다.
    const text = JSON.stringify({
      ...baseResponse,
      mustFix: [],
      niceToHave: [],
      missingTests: [],
      findings: [{ category: 'STYLE', severity: 'NICE_TO_HAVE' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings).toEqual([]);
  });

  it('findings 요소가 정제에서 전부 탈락하면 legacy 3배열에서 파생한다', () => {
    // 회귀 방지: length > 0 만 보고 findings 를 정본으로 확정하면, 정제 후 빈 배열이 된
    // 경우에도 legacy 폴백을 타지 않아 mustFix 의 머지 필수 지적이 조용히 유실된다.
    const text = JSON.stringify({
      ...baseResponse,
      findings: [
        { category: 'STYLE', severity: 'NICE_TO_HAVE' }, // body 없음 → 탈락
        { category: 'RELIABILITY', severity: 'MUST_FIX', body: '   ' }, // 공백 → 탈락
      ],
    });

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

// 보류 값이 없던 동안 잘린 diff 를 본 리뷰가 스스로 "판단 보류" 라고 쓰고도 medium/comment 로
// 채워졌다(run 1421·1970·5320·5331·5478·5515·5599). 판단 보류와 등급의 짝은 코드가 강제한다.
describe('parsePullRequestReview — 판단 보류(undetermined)', () => {
  const blank = {
    summary: 'diff 가 50,000바이트에서 잘려 핵심 변경을 보지 못했다.',
    mustFix: [],
    niceToHave: [],
    missingTests: [],
    reviewCommentDrafts: [],
    findings: [],
  };
  const parse = (overrides: Record<string, unknown>) =>
    parsePullRequestReview(JSON.stringify({ ...blank, ...overrides }));

  it('모델이 등급을 채워 보내도 판단 보류면 riskLevel 을 unknown 으로 덮어쓴다', () => {
    const review = parse({
      riskLevel: 'medium',
      approvalRecommendation: 'undetermined',
      undeterminedReason: '  EntriesService 변경이 잘린 뒷부분에 있다  ',
    });

    expect(review.riskLevel).toBe('unknown');
    expect(review.approvalRecommendation).toBe('undetermined');
    expect(review.undeterminedReason).toBe(
      'EntriesService 변경이 잘린 뒷부분에 있다',
    );
  });

  // 짝이 틀렸다고 리뷰 전체를 실패시키면 같은 응답의 지적까지 잃는다 — 보정하고 알린다.
  it.each([
    ['누락', {}],
    ['공백', { undeterminedReason: '   ' }],
  ])(
    '판단 보류인데 이유가 %s 이면 예외 대신 사유 미기재로 채우고 보정을 알린다',
    (_label, reason) => {
      const onCorrection = jest.fn();
      const review = parsePullRequestReview(
        JSON.stringify({
          ...blank,
          riskLevel: 'unknown',
          approvalRecommendation: 'undetermined',
          ...reason,
        }),
        onCorrection,
      );

      expect(review.approvalRecommendation).toBe('undetermined');
      expect(review.riskLevel).toBe('unknown');
      expect(review.undeterminedReason).toBe(UNDETERMINED_REASON_MISSING);
      expect(onCorrection).toHaveBeenCalledTimes(1);
    },
  );

  it('보류가 아닌데 riskLevel 이 unknown 이면 예외 대신 판단 보류로 올리고 보정을 알린다', () => {
    const onCorrection = jest.fn();
    const review = parsePullRequestReview(
      JSON.stringify({
        ...blank,
        riskLevel: 'unknown',
        approvalRecommendation: 'comment',
        niceToHave: ['주석 보강'],
      }),
      onCorrection,
    );

    expect(review.approvalRecommendation).toBe('undetermined');
    expect(review.riskLevel).toBe('unknown');
    expect(review.undeterminedReason).toBe(UNDETERMINED_REASON_UNKNOWN_RISK);
    // 보정은 판정 칸만 고친다 — 같은 응답의 지적은 그대로 남는다.
    expect(review.niceToHave).toEqual(['주석 보강']);
    expect(review.findings).toHaveLength(1);
    expect(onCorrection).toHaveBeenCalledTimes(1);
  });

  it('riskLevel unknown 이면서 막을 결함이 있으면 request_changes·high 로 올린다', () => {
    const review = parse({
      riskLevel: 'unknown',
      approvalRecommendation: 'approve',
      mustFix: ['널 검사 누락'],
    });

    expect(review.approvalRecommendation).toBe('request_changes');
    expect(review.riskLevel).toBe('high');
  });

  it('짝이 맞는 응답은 보정 알림을 내지 않는다', () => {
    const onCorrection = jest.fn();
    parsePullRequestReview(
      JSON.stringify({
        ...blank,
        riskLevel: 'unknown',
        approvalRecommendation: 'undetermined',
        undeterminedReason: '핵심 파일이 잘렸다',
      }),
      onCorrection,
    );
    parsePullRequestReview(
      JSON.stringify({
        ...blank,
        riskLevel: 'low',
        approvalRecommendation: 'approve',
      }),
      onCorrection,
    );

    expect(onCorrection).not.toHaveBeenCalled();
  });

  it('판단 보류인데 막을 결함(mustFix)을 찾았으면 request_changes·high 로 올린다', () => {
    const review = parse({
      riskLevel: 'unknown',
      approvalRecommendation: 'undetermined',
      undeterminedReason: '뒷부분 미확인',
      mustFix: ['트랜잭션 밖에서 저장한다'],
    });

    expect(review.approvalRecommendation).toBe('request_changes');
    expect(review.riskLevel).toBe('high');
    expect(review.undeterminedReason).toBeUndefined();
  });

  it('보류가 아닌 리뷰에 붙은 이유 필드는 버린다', () => {
    const review = parse({
      riskLevel: 'low',
      approvalRecommendation: 'approve',
      undeterminedReason: '잘못 붙은 값',
    });

    expect(review.undeterminedReason).toBeUndefined();
  });

  it('undeterminedReason 이 문자열이 아니면 스키마 위반', () => {
    expect(() =>
      parse({
        riskLevel: 'unknown',
        approvalRecommendation: 'undetermined',
        undeterminedReason: 42,
      }),
    ).toThrow(CodeReviewerException);
  });
});
