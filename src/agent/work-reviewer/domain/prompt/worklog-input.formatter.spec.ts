import { GithubPullRequestSummary } from '../../../../github/domain/github.type';
import { buildWorklogInput } from './worklog-input.formatter';

const makePullRequest = (
  number: number,
  overrides: Partial<GithubPullRequestSummary> = {},
): GithubPullRequestSummary => ({
  number,
  title: `PR ${number}`,
  body: '',
  repo: 'schoolbell-e/sbe-server',
  url: `https://github.com/schoolbell-e/sbe-server/pull/${number}`,
  state: 'merged',
  mergedAt: '2026-08-11T04:00:00.000Z',
  updatedAt: '2026-08-11T04:00:00.000Z',
  additions: 412,
  deletions: 88,
  changedFilesCount: 14,
  ...overrides,
});

describe('buildWorklogInput', () => {
  it('계획과 머지 PR 실적을 분리하고 PR 정량 지표를 표현한다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: ['- 크롤 실패 대시보드 PR #52 기능·회귀 검증'],
      mergedPullRequests: [makePullRequest(971, { title: '급식 룰 저장' })],
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain('[기간] 2026-08-11');
    expect(result).toContain('## 계획 (PM plan — 의도이지 실적이 아니다)');
    expect(result).toContain('- 크롤 실패 대시보드 PR #52 기능·회귀 검증');
    expect(result).toContain('## 실적 (머지된 PR 1건)');
    expect(result).toContain(
      '- schoolbell-e/sbe-server#971 급식 룰 저장 (+412/-88, 14파일, merged 2026-08-11)',
    );
  });

  it('머지 PR 0건이면 계획 완료를 단정할 근거가 없음을 명시한다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: ['- 계획 항목'],
      mergedPullRequests: [],
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain('## 실적 (머지된 PR 0건)');
    expect(result).toContain(
      '- 이 기간에 머지된 PR 이 없다. 계획 항목의 완료를 단정할 근거가 없다.',
    );
  });

  it('조회 불가 사유가 있으면 PR 목록 대신 단정 금지 문구를 표현한다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: ['- 계획 항목'],
      mergedPullRequests: [makePullRequest(971)],
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: 'GitHub 조회 실패: rate limit',
    });

    expect(result).toContain('## 실적 조회 불가');
    expect(result).toContain('- GitHub 조회 실패: rate limit');
    expect(result).toContain(
      '- 계획만으로 회고하며, 완료·정량 근거를 단정하지 않는다.',
    );
    expect(result).not.toContain('schoolbell-e/sbe-server#971');
  });

  it('plan 파싱 결과가 비어 있으면 기존 fallback 의미를 보존한다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: [],
      mergedPullRequests: [],
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain('## 계획 (PM plan — 의도이지 실적이 아니다)');
    expect(result).toContain('- (plan 파싱 불가)');
  });

  it('PR 60건 초과 시 60건만 표현하고 나머지 건수를 명시한다', () => {
    const mergedPullRequests = Array.from({ length: 63 }, (_, index) =>
      makePullRequest(index + 1),
    );

    const result = buildWorklogInput({
      periodLabel: '2026-08-05 ~ 2026-08-11',
      plannedLines: ['- 계획 항목'],
      mergedPullRequests,
      mergedPullRequestLimit: 60,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain('## 실적 (머지된 PR 63건)');
    expect(result).toContain('- schoolbell-e/sbe-server#60 PR 60');
    expect(result).not.toContain('- schoolbell-e/sbe-server#61 PR 61');
    expect(result).toContain('- (이하 3건 생략)');
  });

  it('조회 결과가 limit에 닿으면 추가 PR 누락 가능성을 숨기지 않는다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: ['- 계획 항목'],
      mergedPullRequests: Array.from({ length: 30 }, (_, index) =>
        makePullRequest(index + 1),
      ),
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain(
      '- (조회 한도 30건 도달 — 추가 머지 PR 이 생략되었을 수 있음)',
    );
  });

  it('머지 시각을 UTC 날짜가 아니라 KST 자정 경계 날짜로 표시한다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: ['- 계획 항목'],
      mergedPullRequests: [
        makePullRequest(971, { mergedAt: '2026-08-10T16:00:00Z' }),
      ],
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain('merged 2026-08-11');
    expect(result).not.toContain('merged 2026-08-10)');
  });

  it('mergedAt이 null이면 기존 날짜 미상 fallback을 유지한다', () => {
    const result = buildWorklogInput({
      periodLabel: '2026-08-11',
      plannedLines: ['- 계획 항목'],
      mergedPullRequests: [makePullRequest(971, { mergedAt: null })],
      mergedPullRequestLimit: 30,
      evidenceUnavailableReason: null,
    });

    expect(result).toContain('merged 날짜 미상');
  });
});
