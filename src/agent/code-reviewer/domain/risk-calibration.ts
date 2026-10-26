import {
  CalibrationPoint,
  CalibrationReport,
  CalibrationSignal,
  DefectLabel,
  LabelPullRequestsInput,
  MergedPullRequest,
  RateCell,
  ScoreRangeCell,
  SignalCell,
  SignalInput,
  SuggestedThresholds,
} from './risk-calibration.type';
import { classifyRiskFileRole } from './risk-file-role';
import { SIZE_SATURATION_LINES } from './risk-map';
import { RiskFileRole, RiskMapLevel } from './risk-map.type';

// 위험 지도 점수가 "문제 있었던 PR" 을 얼마나 가르는지 잰다. Farol(MIT, src/review/calibration.ts)의
// SZZ 근사를 커밋 대신 머지된 PR 단위로 옮겼다 — 머지 커밋 제목("Merge pull request #N")으로는 fix 를 못 알아본다.
// ponytail: 제목 기반 근사라 fix 접두를 안 쓰는 레포·같은 파일의 무관한 fix 는 틀리게 센다. 이슈 연결로 바꿀 때 교체.

const REVERT = /^revert\b/i;
const FIX =
  /^(?:fix|hotfix|bugfix)(?:\([^)]*\))?!?:|\b(?:hot ?fix|bug ?fix|fix(?:es|ed)?)\b/i;
const REVERT_TITLE_PREFIX = 40;
const DAY_MS = 24 * 3600 * 1000;
const SCORE_RANGE_STEP = 20;
// 임계값 제안에 필요한 최소 표본(Farol 과 같다).
const MIN_THRESHOLD_SAMPLE = 5;
// 라벨 근거로 치지 않는 파일 — 테스트·문서·잠금 파일만 같이 고친 fix 는 결함 수정이 아니다.
const LABEL_IGNORED_ROLES = new Set<RiskFileRole>([
  RiskFileRole.TEST,
  RiskFileRole.DOC,
  RiskFileRole.LOCKFILE,
]);
const ROLE_SIGNALS: [RiskFileRole, CalibrationSignal][] = [
  [RiskFileRole.SCHEMA, CalibrationSignal.SCHEMA],
  [RiskFileRole.INFRA, CalibrationSignal.INFRA],
  [RiskFileRole.MANIFEST, CalibrationSignal.MANIFEST],
  [RiskFileRole.ENV, CalibrationSignal.ENV],
  [RiskFileRole.CONFIG, CalibrationSignal.CONFIG],
];
// 후보 신호: 인가·결제처럼 크기와 무관하게 위험한 경로(sbe-api-v5#1237 은 18점 pass 였다).
const SENSITIVE_PATH =
  /(?:^|[/._-])(?:o?auth(?:entication|orization|[nz])?|guards?|permissions?|middlewares?|payments?|billing|sessions?|credentials?|crypto|security|acl|roles?|login|passwords?)(?=$|[/._-])/i;
// 의존성 선언 한 줄: "name": "^1.2.3" — 앞의 범위 기호는 건너뛴다.
const DEPENDENCY_LINE = /^[-+]\s*"([^"]+)"\s*:\s*"[^\d"]*(\d+)\.(\d+)/;
const DEPENDENCY_MANIFEST = /(?:^|\/)(?:package|composer)\.json$/;

interface DependencyVersion {
  major: number;
  minor: number;
}

export const labelPullRequests = ({
  pullRequests,
  windowDays,
}: LabelPullRequestsInput): Map<number, DefectLabel> => {
  const sorted = [...pullRequests].sort(byMergedAt);
  const windowMs = windowDays * DAY_MS;
  return new Map(
    sorted.map((pullRequest, index): [number, DefectLabel] => {
      const mergedAt = Date.parse(pullRequest.mergedAt);
      const follower = sorted
        .slice(index + 1)
        .filter((later) => Date.parse(later.mergedAt) - mergedAt <= windowMs)
        .find((later) => followsUp({ earlier: pullRequest, later }));
      if (follower === undefined) {
        return [pullRequest.number, { bad: false, reason: null }];
      }
      const kind = REVERT.test(follower.title) ? 'revert' : 'fix';
      const reason = `${kind} #${follower.number} ${follower.title.slice(0, 80)}`;
      return [pullRequest.number, { bad: true, reason }];
    }),
  );
};

export const collectSignals = ({
  files,
  removedFiles,
  changedLines,
  diff,
}: SignalInput): CalibrationSignal[] => {
  const roles = files.map(classifyRiskFileRole);
  const hasCode = roles.includes(RiskFileRole.CODE);
  const codeFiles = files.filter(
    (_, index) => roles[index] === RiskFileRole.CODE,
  );
  const flags: [boolean, CalibrationSignal][] = [
    ...ROLE_SIGNALS.map(([role, signal]): [boolean, CalibrationSignal] => [
      roles.includes(role),
      signal,
    ]),
    [
      removedFiles.some(
        (path) => classifyRiskFileRole(path) === RiskFileRole.TEST,
      ),
      CalibrationSignal.TEST_REMOVED,
    ],
    [
      hasCode && !roles.includes(RiskFileRole.TEST),
      CalibrationSignal.NO_TEST_TOUCHED,
    ],
    [changedLines >= SIZE_SATURATION_LINES, CalibrationSignal.LARGE],
    [
      codeFiles.some((path) => SENSITIVE_PATH.test(path)),
      CalibrationSignal.SENSITIVE_PATH,
    ],
    [hasDependencyBump(diff), CalibrationSignal.DEPENDENCY_BUMP],
  ];
  return flags.filter(([on]) => on).map(([, signal]) => signal);
};

// major 가 바뀌었거나 0.x 에서 minor 가 바뀐 의존성이 하나라도 있는가.
export const hasDependencyBump = (diff: string): boolean => {
  const removed = new Map<string, DependencyVersion>();
  const added = new Map<string, DependencyVersion>();
  diff.split('\n').reduce((file, line) => {
    if (line.startsWith('+++ ')) {
      return line.replace(/^\+\+\+ (?:b\/)?/, '');
    }
    if (line.startsWith('--- ') || !DEPENDENCY_MANIFEST.test(file)) {
      return file;
    }
    const found = DEPENDENCY_LINE.exec(line);
    if (found !== null) {
      const target = line.startsWith('-') ? removed : added;
      target.set(`${file}:${found[1]}`, {
        major: Number(found[2]),
        minor: Number(found[3]),
      });
    }
    return file;
  }, '');
  return [...added].some(([key, after]) => {
    const before = removed.get(key);
    if (before === undefined) {
      return false;
    }
    if (before.major !== after.major) {
      return true;
    }
    return before.major === 0 && before.minor !== after.minor;
  });
};

export const calibrate = (
  points: readonly CalibrationPoint[],
): CalibrationReport => {
  const all = cellOf(points);
  return {
    total: all.n,
    bad: all.bad,
    baseRate: all.rate,
    auc: aucOf(points),
    byLevel: {
      [RiskMapLevel.PASS]: cellOf(points.filter(atLevel(RiskMapLevel.PASS))),
      [RiskMapLevel.QUICK]: cellOf(points.filter(atLevel(RiskMapLevel.QUICK))),
      [RiskMapLevel.CAREFUL]: cellOf(
        points.filter(atLevel(RiskMapLevel.CAREFUL)),
      ),
    },
    byScore: scoreRanges(points),
    bySignal: Object.values(CalibrationSignal).map(
      (signal): SignalCell => ({
        signal,
        with: cellOf(points.filter((point) => point.signals.includes(signal))),
        without: cellOf(
          points.filter((point) => !point.signals.includes(signal)),
        ),
      }),
    ),
    suggested: suggestThresholds({ points, baseRate: all.rate }),
  };
};

const followsUp = ({
  earlier,
  later,
}: {
  earlier: MergedPullRequest;
  later: MergedPullRequest;
}): boolean => {
  if (REVERT.test(later.title)) {
    return (
      later.title.includes(earlier.title.slice(0, REVERT_TITLE_PREFIX)) ||
      later.title.includes(`#${earlier.number}`)
    );
  }
  if (!FIX.test(later.title)) {
    return false;
  }
  const earlierFiles = new Set(labelFiles(earlier.files));
  return labelFiles(later.files).some((path) => earlierFiles.has(path));
};

const labelFiles = (files: readonly string[]): string[] =>
  files.filter((path) => !LABEL_IGNORED_ROLES.has(classifyRiskFileRole(path)));

const byMergedAt = (
  left: MergedPullRequest,
  right: MergedPullRequest,
): number =>
  Date.parse(left.mergedAt) - Date.parse(right.mergedAt) ||
  left.number - right.number;

const atLevel =
  (level: RiskMapLevel) =>
  (point: CalibrationPoint): boolean =>
    point.level === level;

const rateOf = ({ bad, n }: { bad: number; n: number }): number =>
  n === 0 ? 0 : Math.round((bad / n) * 1000) / 1000;

const cellOf = (points: readonly CalibrationPoint[]): RateCell => {
  const bad = points.filter((point) => point.bad).length;
  return { n: points.length, bad, rate: rateOf({ bad, n: points.length }) };
};

const scoreRanges = (points: readonly CalibrationPoint[]): ScoreRangeCell[] =>
  [0, 20, 40, 60, 80].map((low): ScoreRangeCell => {
    const high = low === 80 ? 100 : low + SCORE_RANGE_STEP - 1;
    const inRange = points.filter(
      (point) => point.score >= low && point.score <= high,
    );
    return { range: `${low}–${high}`, ...cellOf(inRange) };
  });

// 짝마다 문제 PR 점수가 높으면 1, 같으면 0.5. 한쪽이 비면 잴 수 없다.
const aucOf = (points: readonly CalibrationPoint[]): number | null => {
  const bads = points.filter((point) => point.bad);
  const goods = points.filter((point) => !point.bad);
  if (bads.length === 0 || goods.length === 0) {
    return null;
  }
  const wins = bads
    .flatMap((bad) => goods.map((good) => compareScore(bad.score, good.score)))
    .reduce((sum, win) => sum + win, 0);
  return Math.round((wins / (bads.length * goods.length)) * 1000) / 1000;
};

const compareScore = (bad: number, good: number): number => {
  if (bad === good) {
    return 0.5;
  }
  return bad > good ? 1 : 0;
};

// quick: 그 점수 미만의 문제 비율이 기준의 절반 이하인 가장 높은 점수.
// careful: 그 점수 이상의 문제 비율이 기준의 1.5배 이상인 가장 낮은 점수.
const suggestThresholds = ({
  points,
  baseRate,
}: {
  points: readonly CalibrationPoint[];
  baseRate: number;
}): SuggestedThresholds => {
  if (baseRate === 0) {
    return { quick: null, careful: null };
  }
  const scores = [...new Set(points.map((point) => point.score))].sort(
    (left, right) => left - right,
  );
  const quickCandidates = scores.filter((score) => {
    const below = cellOf(points.filter((point) => point.score < score));
    return below.n >= MIN_THRESHOLD_SAMPLE && below.rate <= baseRate / 2;
  });
  const carefulCandidates = scores.filter((score) => {
    const above = cellOf(points.filter((point) => point.score >= score));
    return above.n >= MIN_THRESHOLD_SAMPLE && above.rate >= baseRate * 1.5;
  });
  return {
    quick: quickCandidates.at(-1) ?? null,
    careful: carefulCandidates.at(0) ?? null,
  };
};
