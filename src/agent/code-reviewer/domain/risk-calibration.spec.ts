import {
  calibrate,
  collectSignals,
  hasDependencyBump,
  labelPullRequests,
} from './risk-calibration';
import {
  CalibrationPoint,
  CalibrationSignal,
  MergedPullRequest,
} from './risk-calibration.type';
import { RiskMapLevel } from './risk-map.type';

const pullRequest = (
  number: number,
  title: string,
  day: number,
  files: string[],
): MergedPullRequest => ({
  number,
  title,
  mergedAt: new Date(Date.UTC(2026, 5, day)).toISOString(),
  files,
});

const point = (
  score: number,
  bad: boolean,
  signals: CalibrationSignal[] = [],
): CalibrationPoint => ({
  repo: 'owner/repo',
  number: score,
  score,
  level: score >= 60 ? RiskMapLevel.CAREFUL : RiskMapLevel.PASS,
  signals,
  bad,
  reason: null,
});

describe('labelPullRequests', () => {
  it('같은 코드 파일을 창 안에서 고친 fix 가 따라오면 문제 PR 이다', () => {
    const labels = labelPullRequests({
      pullRequests: [
        pullRequest(2, 'fix(auth): 토큰 만료', 10, ['src/auth.ts']),
        pullRequest(1, 'feat: 로그인', 1, ['src/auth.ts', 'src/a.ts']),
      ],
      windowDays: 14,
    });

    expect(labels.get(1)).toEqual({
      bad: true,
      reason: 'fix #2 fix(auth): 토큰 만료',
    });
    expect(labels.get(2)?.bad).toBe(false);
  });

  it('창 밖 fix · 다른 파일 fix · 테스트만 겹친 fix 는 세지 않는다', () => {
    const labels = labelPullRequests({
      pullRequests: [
        pullRequest(1, 'feat: A', 1, ['src/a.ts', 'src/a.spec.ts']),
        pullRequest(2, 'fix: 늦은 수정', 20, ['src/a.ts']),
        pullRequest(3, 'fix: 다른 파일', 3, ['src/b.ts']),
        pullRequest(4, 'fix: 테스트만', 4, ['src/a.spec.ts']),
      ],
      windowDays: 14,
    });

    expect(labels.get(1)?.bad).toBe(false);
  });

  it('제목이나 번호를 담은 revert 는 파일과 무관하게 문제 PR 로 센다', () => {
    const labels = labelPullRequests({
      pullRequests: [
        pullRequest(7, 'feat: 결제 연동', 1, ['src/pay.ts']),
        pullRequest(8, 'Revert "feat: 결제 연동"', 2, []),
        pullRequest(9, 'feat: 기타', 3, ['src/x.ts']),
        pullRequest(10, 'Revert #9', 4, []),
      ],
      windowDays: 14,
    });

    expect(labels.get(7)?.reason).toBe('revert #8 Revert "feat: 결제 연동"');
    expect(labels.get(9)?.bad).toBe(true);
  });

  it('번호가 앞부분만 같은 PR 은 revert 대상이 아니다', () => {
    const labels = labelPullRequests({
      pullRequests: [
        pullRequest(12, 'feat: A', 1, ['src/a.ts']),
        pullRequest(123, 'feat: B', 2, ['src/b.ts']),
        pullRequest(130, 'Revert #123', 3, []),
      ],
      windowDays: 14,
    });

    expect(labels.get(12)?.bad).toBe(false);
    expect(labels.get(123)?.bad).toBe(true);
  });
});

describe('collectSignals', () => {
  it('역할·크기·민감 경로 신호를 모은다', () => {
    const signals = collectSignals({
      files: ['prisma/schema.prisma', 'src/auth/auth.guard.ts', 'src/user.ts'],
      removedFiles: ['src/user.spec.ts'],
      changedLines: 400,
      diff: '',
    });

    expect(signals).toEqual([
      CalibrationSignal.SCHEMA,
      CalibrationSignal.TEST_REMOVED,
      CalibrationSignal.NO_TEST_TOUCHED,
      CalibrationSignal.LARGE,
      CalibrationSignal.SENSITIVE_PATH,
    ]);
  });

  it('경로 조각이 아닌 부분 일치는 민감 경로가 아니다', () => {
    const signals = collectSignals({
      files: ['src/author/author.service.ts', 'src/a.spec.ts'],
      removedFiles: [],
      changedLines: 10,
      diff: '',
    });

    expect(signals).toEqual([]);
  });
});

describe('hasDependencyBump', () => {
  const manifestDiff = (before: string, after: string): string =>
    [
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      `-    "lib": "${before}",`,
      `+    "lib": "${after}",`,
    ].join('\n');

  it.each([
    ['^1.2.3', '^2.0.0', true],
    ['~0.3.1', '~0.4.0', true],
    ['^1.2.3', '^1.9.0', false],
    ['0.3.1', '0.3.9', false],
  ])('%s → %s 는 %s', (before, after, expected) => {
    expect(hasDependencyBump(manifestDiff(before, after))).toBe(expected);
  });

  it('서로 다른 manifest 의 삭제·추가 줄은 짝짓지 않는다', () => {
    const diff = [
      '--- a/apps/a/package.json',
      '+++ b/apps/a/package.json',
      '-    "lib": "^1.0.0",',
      '--- a/apps/b/package.json',
      '+++ b/apps/b/package.json',
      '+    "lib": "^2.0.0",',
    ].join('\n');

    expect(hasDependencyBump(diff)).toBe(false);
  });

  it('manifest 밖 파일의 같은 모양 줄은 보지 않는다', () => {
    const diff = manifestDiff('^1.0.0', '^2.0.0').replace(
      /package\.json/g,
      'fixtures/data.json',
    );

    expect(hasDependencyBump(diff)).toBe(false);
  });
});

describe('calibrate', () => {
  it('점수가 문제 PR 을 완벽히 가르면 AUC 1, 구간·등급·신호별 비율을 낸다', () => {
    const points = [
      ...[5, 6, 7, 8, 9, 10].map((score) => point(score, false)),
      ...[70, 80].map((score) =>
        point(score, true, [CalibrationSignal.SCHEMA]),
      ),
    ];

    const report = calibrate(points);

    expect(report).toMatchObject({ total: 8, bad: 2, baseRate: 0.25, auc: 1 });
    expect(report.byLevel[RiskMapLevel.CAREFUL]).toEqual({
      n: 2,
      bad: 2,
      rate: 1,
    });
    expect(report.byScore[0]).toEqual({ range: '0–19', n: 6, bad: 0, rate: 0 });
    expect(report.byScore[4]).toEqual({
      range: '80–100',
      n: 1,
      bad: 1,
      rate: 1,
    });
    const schema = report.bySignal.find(
      (cell) => cell.signal === CalibrationSignal.SCHEMA,
    );
    expect(schema?.with).toEqual({ n: 2, bad: 2, rate: 1 });
    // 따로 고르면 quick 70 · careful 8 로 역전된다 — 쓸 수 없는 제안이라 내지 않는다.
    expect(report.suggested).toEqual({ quick: null, careful: null });
  });

  it('동점은 반으로 치고, 문제 PR 이 없으면 AUC·제안이 없다', () => {
    expect(calibrate([point(10, true), point(10, false)]).auc).toBe(0.5);
    expect(calibrate([point(10, false)])).toMatchObject({
      auc: null,
      suggested: { quick: null, careful: null },
    });
  });
});
