import {
  PullRequestReview,
  ReviewFinding,
} from '../../agent/code-reviewer/domain/code-reviewer.type';
import {
  formatPullRequestPublication,
  formatPullRequestReview,
} from './pull-request-review.formatter';

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
  it.each([
    ['low', 'approve', '낮음', '승인'],
    ['medium', 'comment', '보통', '검토 필요'],
    ['high', 'request_changes', '높음', '수정 요청'],
    ['unknown', 'undetermined', '확인 불가', '검토 필요'],
  ] as const)(
    '위험도 %s와 권고 %s를 한국어로 표시한다',
    (riskLevel, approvalRecommendation, risk, recommendation) => {
      const text = formatPullRequestReview({
        prRef: 'o/r#1',
        review: { ...baseReview(), riskLevel, approvalRecommendation },
      });
      expect(text).toContain(`위험도: ${risk}`);
      expect(text).toContain(`권고: ${recommendation}`);
      expect(text).not.toMatch(/(?:꼭 고칠 것|고려할 것) 0개/);
    },
  );
  it('위험도와 권고 및 지적 종류별 개수를 표시한다', () => {
    const text = formatPullRequestReview({
      prRef: 'o/r#1',
      review: {
        ...baseReview(),
        riskLevel: 'high',
        approvalRecommendation: 'request_changes',
        mustFix: ['API_TOKEN 확인'],
        niceToHave: ['개선'],
        missingTests: ['테스트'],
      },
    });
    expect(text).toContain('위험도: 높음');
    expect(text).toContain('권고: 수정 요청');
    expect(text).toContain('꼭 고칠 것 1개');
    expect(text).toContain('고려할 것 2개');
    expect(text).toContain('API_TOKEN 확인');
  });
  it('판단 보류면 보류 라벨과 이유를 내고 "지적 사항 없음" 을 붙이지 않는다 — 못 본 것이지 안전한 게 아니다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: {
        ...baseReview(),
        riskLevel: 'unknown',
        approvalRecommendation: 'undetermined',
        undeterminedReason: '핵심 파일이 잘린 diff 에 없다',
      },
    });

    expect(text).toContain('판단 보류');
    expect(text).toContain('핵심 파일이 잘린 diff 에 없다');
    expect(text).not.toContain(NO_FINDING_NOTICE);
  });

  it('PR 제목이 있으면 요약 대신 제목으로 본문을 연다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      prTitle: '로그인 오류 수정',
      review: { ...baseReview(), summary: '모델이 쓴 요약' },
    });
    expect(text).toContain('*로그인 오류 수정 리뷰*');
    expect(text).not.toContain('*모델이 쓴 요약 리뷰*');
  });

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
    expect(text).toContain('• 널 검사 누락');
  });

  it('본문 요약과 지적에서 비밀 값과 코드 펜스를 제거한다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: {
        ...baseReview(),
        summary: '로그인 오류 password=hunter2',
        mustFix: ['토큰 xoxb-123-abc 가 노출됩니다.'],
        findings: [finding('자격증명 https://u:p@h/x 가 노출됩니다.')],
        approvalRecommendation: 'undetermined',
        undeterminedReason: '검증 실패 pwd=secret ```',
      },
    });
    expect(text).toContain('로그인 오류');
    expect(text).not.toMatch(/hunter2|xoxb-123-abc|u:p@|pwd=secret|```/);
  });

  it('본문에는 쉬운 한 줄 요약만 쓰고 지적 원문과 내부 설정명을 숨긴다', () => {
    const text = formatPullRequestReview({
      prRef: 'owner/repo#1',
      review: {
        ...baseReview(),
        summary: '로그인 오류 수정',
        mustFix: [
          '로그인 시 토큰 검증이 빠졌습니다. 원문 상세: PR_REVIEW_INLINE_REPOS',
        ],
        reviewCommentDrafts: [
          { file: 'src/auth.ts', line: 12, body: '원문 상세: secret' },
        ],
      },
    });

    expect(text).toContain('*로그인 오류 수정 리뷰*');
    expect(text).toContain('꼭 고칠 것 1개');
    expect(text).toContain('• 로그인 시 토큰 검증이 빠졌습니다.');
    expect(text).not.toContain('원문 상세');
    expect(text).not.toContain('PR_REVIEW_INLINE_REPOS');
    expect(text).not.toContain('src/auth.ts');
  });
});

describe('formatPullRequestPublication', () => {
  const outcome = {
    inline: 0,
    file: 0,
    issueComment: 0,
    dryRun: 0,
    notPosted: 0,
    dropped: 0,
    duplicate: 0,
  };

  it('게시한 코멘트 수와 PR 링크, 제외·미게시 사유를 함께 쓴다', () => {
    const line = formatPullRequestPublication({
      kind: 'POSTED',
      repo: 'o/r',
      pullNumber: 3,
      outcome: { ...outcome, inline: 2, file: 1, duplicate: 1, dropped: 2 },
    });
    expect(line).toContain('<https://github.com/o/r/pull/3|PR>');
    expect(line).toContain('지적 3건을 게시');
    expect(line).toContain('이미 게시된 지적 1건 제외');
    expect(line).toContain('게시 상한 초과 2건 미게시');
  });

  it('지적이 없으면 게시 성공처럼 쓰지 않는다', () => {
    expect(
      formatPullRequestPublication({
        kind: 'POSTED',
        repo: 'o/r',
        pullNumber: 3,
        outcome,
      }),
    ).toBe('_게시할 지적이 없어 GitHub 에 코멘트를 달지 않았어요._');
  });

  it('전부 중복이면 새로 게시한 것이 없다고 쓴다', () => {
    expect(
      formatPullRequestPublication({
        kind: 'POSTED',
        repo: 'o/r',
        pullNumber: 3,
        outcome: { ...outcome, duplicate: 2 },
      }),
    ).toContain('새로 게시한 지적은 없어요');
  });

  it.each([
    [
      { kind: 'NOT_ALLOWED' as const, repo: 'o/r' },
      '게시 대상에 등록되지 않았어요',
    ],
    [{ kind: 'FAILED' as const, message: '403' }, '게시에 실패했어요'],
    [
      { kind: 'DRY_RUN' as const, outcome: { ...outcome, dryRun: 2 } },
      '연습 모드라',
    ],
  ])('%o 은 "%s" 로 알린다', (publication, expected) => {
    expect(formatPullRequestPublication(publication)).toContain(expected);
  });

  it('게시 실패 원문(외부 API 응답 등)은 사용자 문구에 싣지 않는다', () => {
    const line = formatPullRequestPublication({
      kind: 'FAILED',
      message:
        'HttpError: Bad credentials https://api.github.com token=ghp_secret',
    });
    expect(line).not.toContain('ghp_secret');
    expect(line).not.toContain('api.github.com');
    expect(line).toContain('서버 로그');
  });
});
