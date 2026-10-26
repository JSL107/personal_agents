import { match } from 'ts-pattern';

import { ChangedFileStatus } from '../../../github/domain/github.type';
import { ReviewFinding } from './code-reviewer.type';
import { mapTestsToSources } from './companion-spec';
import { AddedLine, listAddedLines } from './diff-added-lines';
import { findLeakedToken, findSuppression } from './risk-added-line';
import {
  classifyRiskFileRole,
  isDeclarationFile,
  isPairableSource,
} from './risk-file-role';
import {
  ComputeRiskMapInput,
  LevelDecision,
  LevelInput,
  RiskFileRole,
  RiskItem,
  RiskMap,
  RiskMapDiff,
  RiskMapFile,
  RiskMapLevel,
  RiskMapPullRequest,
} from './risk-map.type';

// 승인자용 위험 지도. 항목마다 0~100점을 매기고 1 − Π(1 − 점수/100) 으로 합친다 — Farol(MIT,
// src/report/merge-score.ts)의 방식이다. 숫자는 이 코드만 정하고 LLM 은 관여하지 않는다(같은 PR = 같은 점수).
// ponytail: 아래 점수는 Farol 기본값과 표본 PR 몇 건으로 처음 정한 값이다. revert·fix 이력으로 보정하기
// 전까지는 근거가 얕다.

// 항목별 점수(0~100). "~Size" 는 바뀐 줄 수에 비례해 SIZE_SATURATION_LINES 줄에서 다 차는 몫이다.
export const RISK_POINTS = {
  modifiedBase: 2,
  modifiedSize: 18,
  addedBase: 2,
  addedSize: 8,
  removedCode: 15,
  viewBase: 1,
  viewSize: 4,
  // 이 셋은 PR 전체 합계 상한이다. 파일이 여럿이면 나눠 갖는다.
  schemaTotal: 35,
  infraTotal: 12,
  untestedTotal: 20,
  // 짝 테스트 없이 바뀐 파일 하나의 상한(크기 비례).
  untestedFile: 15,
  manifest: 10,
  lockfile: 3,
  env: 5,
  config: 10,
  testRemoved: 10,
  testTrimmed: 5,
  testTouched: 2,
  suppression: 2,
  secret: 30,
  unknownFiles: 25,
} as const;

export const SIZE_SATURATION_LINES = 400;
export const TEST_TRIMMED_LINES = 10;
export const QUICK_SCORE = 25;
export const CAREFUL_SCORE = 60;
export const START_HERE_MAX = 7;
export const START_HERE_MIN_POINTS = 5;
// 짝 테스트 신호의 크기 비례분이 이보다 작으면(몇 줄짜리 수정) 싣지 않는다.
export const MIN_ITEM_POINTS = 0.5;
// 억제 지시문 수천 줄짜리 PR 에서도 코멘트가 GitHub 한도를 넘지 않게 파일당 사유 수를 자른다.
export const MAX_REASONS_PER_FILE = 6;

const STATUS_LABEL: Record<ChangedFileStatus, string> = {
  added: '신규',
  removed: '삭제',
  modified: '수정',
  renamed: '이름 변경',
};

interface RiskContext {
  detail: RiskMapPullRequest;
  roles: ReadonlyMap<string, RiskFileRole>;
  statusOf: (path: string) => ChangedFileStatus;
  linesOf: (path: string) => number;
}

export const computeRiskMap = ({
  detail,
  diff,
  findings,
}: ComputeRiskMapInput): RiskMap => {
  const context = buildContext(detail);
  const testItems = collectTestItems(context);
  const schemaItems = collectSharedRoleItems({
    context,
    role: RiskFileRole.SCHEMA,
    total: RISK_POINTS.schemaTotal,
    reason: 'DB 스키마·마이그레이션 변경 — 데이터 유실·배포 순서 확인',
  });
  const infraItems = collectSharedRoleItems({
    context,
    role: RiskFileRole.INFRA,
    total: RISK_POINTS.infraTotal,
    reason: '배포·CI 설정 변경 — 환경마다 확인',
  });
  const untested = collectUntestedItems(context);
  const addedLines = listAddedLines(diff.diff);
  const suppressionItems = collectSuppressionItems({ context, addedLines });
  const tokenItems = collectTokenItems(addedLines);
  const items: RiskItem[] = [
    ...collectChangeItems(context),
    ...testItems,
    ...schemaItems,
    ...infraItems,
    ...untested.items,
    ...suppressionItems,
    ...tokenItems,
    ...collectTruncationItems(detail),
  ];

  const score = combine(items.map((item) => item.points));
  const level = decideLevel({
    score,
    secretFound: tokenItems.length > 0,
    schemaChanged: schemaItems.length > 0,
    infraChanged: infraItems.length > 0,
    filesTruncated: detail.changedFilesTruncated,
    testsCut: testItems.some((item) => item.points >= RISK_POINTS.testTrimmed),
  });
  const rows = buildFileRows({ context, items, findings });
  const { startHere, lowCount, overflowCount } = pickStartHere(rows);
  const notes = collectNotes({
    detail,
    diff,
    unpairableCount: untested.unpairableCount,
  });

  return {
    level: level.level,
    score,
    levelReasons: level.reasons,
    startHere,
    lowCount,
    overflowCount,
    notes,
  };
};

// 점수 말고도 그것만으로 등급을 올리는 사유가 있다(Farol verdict.ts 와 같은 구조).
export const decideLevel = (input: LevelInput): LevelDecision => {
  const careful: string[] = [];
  const quick: string[] = [];
  if (input.score >= CAREFUL_SCORE) {
    careful.push(`위험 점수 ${input.score}/100`);
  } else if (input.score >= QUICK_SCORE) {
    quick.push(`위험 점수 ${input.score}/100`);
  }
  if (input.secretFound) {
    careful.push('추가된 줄에 자격증명 형식 문자열');
  }
  if (input.schemaChanged) {
    quick.push('DB 스키마·마이그레이션 변경');
  }
  if (input.infraChanged) {
    quick.push('배포·CI 설정 변경');
  }
  if (input.testsCut) {
    quick.push('기존 테스트 삭제·대폭 축소');
  }
  if (input.filesTruncated) {
    quick.push('일부 파일 미분석');
  }
  if (careful.length > 0) {
    return { level: RiskMapLevel.CAREFUL, reasons: [...careful, ...quick] };
  }
  if (quick.length > 0) {
    return { level: RiskMapLevel.QUICK, reasons: quick };
  }
  const reason = `위험 점수 ${input.score}/100 — 넓게 영향을 줄 변경이 보이지 않음`;
  return { level: RiskMapLevel.PASS, reasons: [reason] };
};

const buildContext = (detail: RiskMapPullRequest): RiskContext => {
  const roles = new Map(
    detail.changedFiles.map((path) => [path, classifyRiskFileRole(path)]),
  );
  return {
    detail,
    roles,
    statusOf: (path) =>
      detail.changedFileStatsByFile?.[path]?.status ?? 'modified',
    linesOf: (path) => detail.changedLinesByFile[path] ?? 0,
  };
};

const pathsWithRole = ({
  context,
  role,
}: {
  context: RiskContext;
  role: RiskFileRole;
}): string[] =>
  context.detail.changedFiles.filter(
    (path) => context.roles.get(path) === role,
  );

const collectChangeItems = (context: RiskContext): RiskItem[] =>
  context.detail.changedFiles.flatMap((path) => {
    const item = changeItem({
      path,
      role: context.roles.get(path) ?? RiskFileRole.OTHER,
      status: context.statusOf(path),
      lines: context.linesOf(path),
    });
    return item === null ? [] : [item];
  });

const changeItem = ({
  path,
  role,
  status,
  lines,
}: {
  path: string;
  role: RiskFileRole;
  status: ChangedFileStatus;
  lines: number;
}): RiskItem | null => {
  const label = `${STATUS_LABEL[status]} ${lines}줄`;
  const fixed = ({
    points,
    reason,
  }: {
    points: number;
    reason: string;
  }): RiskItem => ({ file: path, points, reason });
  return match(role)
    .with(RiskFileRole.CODE, () =>
      codeChangeItem({ path, status, lines, label }),
    )
    .with(RiskFileRole.VIEW, () => {
      const points =
        RISK_POINTS.viewBase + RISK_POINTS.viewSize * sizeShare(lines);
      return fixed({ points, reason: `화면 템플릿·스타일 ${label}` });
    })
    .with(RiskFileRole.MANIFEST, () =>
      fixed({ points: RISK_POINTS.manifest, reason: '의존성 선언 변경' }),
    )
    .with(RiskFileRole.LOCKFILE, () =>
      fixed({ points: RISK_POINTS.lockfile, reason: '잠금 파일 변경' }),
    )
    .with(RiskFileRole.ENV, () =>
      fixed({
        points: RISK_POINTS.env,
        reason: '환경 변수 정의 변경 — 배포 환경마다 확인',
      }),
    )
    .with(RiskFileRole.CONFIG, () =>
      fixed({
        points: RISK_POINTS.config,
        reason: '빌드·도구 설정 변경 — 전체에 영향',
      }),
    )
    .otherwise(() => null);
};

// 바뀐 줄 수에 비례해 키운다 — 작은 수정 여러 개가 쌓여 높은 점수가 되지 않게.
const codeChangeItem = ({
  path,
  status,
  lines,
  label,
}: {
  path: string;
  status: ChangedFileStatus;
  lines: number;
  label: string;
}): RiskItem => {
  if (status === 'removed') {
    return {
      file: path,
      points: RISK_POINTS.removedCode,
      reason: '코드 파일 삭제',
    };
  }
  const isAdded = status === 'added';
  const base = isAdded ? RISK_POINTS.addedBase : RISK_POINTS.modifiedBase;
  const size = isAdded ? RISK_POINTS.addedSize : RISK_POINTS.modifiedSize;
  const points = base + size * sizeShare(lines);
  return { file: path, points, reason: label };
};

const collectTestItems = (context: RiskContext): RiskItem[] => {
  const stats = context.detail.changedFileStatsByFile;
  if (stats === undefined) {
    return [];
  }
  return pathsWithRole({ context, role: RiskFileRole.TEST }).flatMap((path) => {
    const { status, deletions } = stats[path] ?? {
      status: 'modified',
      deletions: 0,
    };
    const item = testItem({
      path,
      status,
      additions: context.linesOf(path) - deletions,
      deletions,
    });
    return item === null ? [] : [item];
  });
};

// 순감(삭제 − 추가)으로 본다. 삭제 줄 수만 보면 테스트를 다시 쓰며 늘린 PR 이 "축소" 로 잡힌다.
const testItem = ({
  path,
  status,
  additions,
  deletions,
}: {
  path: string;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
}): RiskItem | null => {
  if (status === 'removed') {
    return {
      file: path,
      points: RISK_POINTS.testRemoved,
      reason: '기존 테스트 파일 삭제',
    };
  }
  const shrunk = deletions - additions;
  if (status === 'added' || shrunk <= 0) {
    return null;
  }
  const points =
    shrunk >= TEST_TRIMMED_LINES
      ? RISK_POINTS.testTrimmed
      : RISK_POINTS.testTouched;
  return { file: path, points, reason: `기존 테스트 ${shrunk}줄 순감` };
};

// 파일이 여럿이어도 PR 점수는 total 을 넘지 않게 나눠 갖고, 파일 순위에는 나누기 전 점수를 쓴다.
const collectSharedRoleItems = ({
  context,
  role,
  total,
  reason,
}: {
  context: RiskContext;
  role: RiskFileRole;
  total: number;
  reason: string;
}): RiskItem[] => {
  const paths = pathsWithRole({ context, role });
  const points = sharedPoints({ total, count: paths.length });
  return paths.map((path) => ({
    file: path,
    points,
    filePoints: total,
    reason,
  }));
};

interface UntestedResult {
  items: RiskItem[];
  unpairableCount: number;
}

// 이 PR 에서 함께 고친 테스트만 본다(트리 조회 없음). 원래 테스트가 없는 소스와 고칠 필요가 없었던
// 소스를 가르지 못해 크기 비례 + 합계 상한으로 약하게 건다. 지운 테스트는 짝으로 치지 않는다.
const collectUntestedItems = (context: RiskContext): UntestedResult => {
  const testedInPr = mapTestsToSources(
    context.detail.changedFiles.filter(
      (path) => context.statusOf(path) !== 'removed',
    ),
  );
  const candidates = pathsWithRole({ context, role: RiskFileRole.CODE }).filter(
    (path) => context.statusOf(path) !== 'removed' && !isDeclarationFile(path),
  );
  const untested = candidates.filter(
    (path) => isPairableSource(path) && !testedInPr.has(path),
  );
  const share = sharedPoints({
    total: RISK_POINTS.untestedTotal,
    count: untested.length,
  });
  const items = untested.flatMap((path): RiskItem[] => {
    const bySize = RISK_POINTS.untestedFile * sizeShare(context.linesOf(path));
    if (bySize < MIN_ITEM_POINTS) {
      return [];
    }
    const points = Math.min(share, bySize);
    return [
      {
        file: path,
        points,
        filePoints: bySize,
        reason: '이 PR 에서 짝 테스트를 고치지 않음',
      },
    ];
  });
  const unpairableCount = candidates.filter(
    (path) => !isPairableSource(path),
  ).length;
  return { items, unpairableCount };
};

const collectSuppressionItems = ({
  context,
  addedLines,
}: {
  context: RiskContext;
  addedLines: readonly AddedLine[];
}): RiskItem[] =>
  addedLines.flatMap(({ file, line, text }): RiskItem[] => {
    const role = context.roles.get(file) ?? classifyRiskFileRole(file);
    if (role === RiskFileRole.TEST || role === RiskFileRole.DOC) {
      return [];
    }
    const suppression = findSuppression(text);
    if (suppression === undefined) {
      return [];
    }
    const reason = `\`${suppression}\` 추가`;
    return [{ file, points: RISK_POINTS.suppression, reason, line }];
  });

const collectTokenItems = (addedLines: readonly AddedLine[]): RiskItem[] =>
  addedLines.flatMap(({ file, line, text }): RiskItem[] => {
    const token = findLeakedToken(text);
    if (token === undefined) {
      return [];
    }
    const reason = `${token} 형식 문자열 — 유출 여부 확인`;
    return [{ file, points: RISK_POINTS.secret, reason, line }];
  });

const collectTruncationItems = (detail: RiskMapPullRequest): RiskItem[] => {
  if (!detail.changedFilesTruncated) {
    return [];
  }
  return [
    {
      file: null,
      points: RISK_POINTS.unknownFiles,
      reason: '변경 파일 목록이 잘려 일부 파일을 보지 못함',
    },
  ];
};

const collectNotes = ({
  detail,
  diff,
  unpairableCount,
}: {
  detail: RiskMapPullRequest;
  diff: RiskMapDiff;
  unpairableCount: number;
}): string[] => {
  const notes: string[] = [];
  if (detail.changedFilesTruncated) {
    notes.push(
      `변경 파일 ${detail.changedFilesTotalCount}개 중 ${detail.changedFiles.length}개만 분석했습니다.`,
    );
  }
  if (diff.truncated) {
    notes.push(
      'diff 가 잘려 추가 줄 검사(억제 지시문·토큰 형식)는 앞부분만 봤습니다.',
    );
  }
  if (detail.changedFileStatsByFile === undefined) {
    notes.push(
      '파일별 변경 종류를 받지 못해 모두 수정으로 보고, 테스트 삭제는 보지 않았습니다.',
    );
  }
  if (unpairableCount > 0) {
    notes.push(
      `짝 테스트를 판정하지 못한 코드 파일 ${unpairableCount}개(JS·TS·PHP 밖)는 테스트 신호를 빼고 계산했습니다.`,
    );
  }
  return notes;
};

const buildFileRows = ({
  context,
  items,
  findings,
}: {
  context: RiskContext;
  items: readonly RiskItem[];
  findings: readonly ReviewFinding[];
}): RiskMapFile[] =>
  context.detail.changedFiles
    .map((path): RiskMapFile => {
      const own = items.filter((item) => item.file === path);
      const fileFindings = findings.filter((finding) => finding.file === path);
      const mustFixCount = fileFindings.filter(
        (finding) => finding.severity === 'MUST_FIX',
      ).length;
      return {
        path,
        role: context.roles.get(path) ?? RiskFileRole.OTHER,
        points: combine(own.map((item) => item.filePoints ?? item.points)),
        reasons: summarizeReasons(own),
        findingCount: fileFindings.length,
        mustFixCount,
      };
    })
    .sort(byPointsThenPath);

interface StartHerePick {
  startHere: RiskMapFile[];
  lowCount: number;
  overflowCount: number;
}

// 점수가 기준 이상이거나 머지 전 필수 지적이 있는 파일이 후보다 — 필수 지적이 달린 파일을 "훑어봐도 된다" 로
// 안내하지 않게. 후보가 상한보다 많으면 넘친 수를 따로 센다(점수가 낮아서 빠진 것과 다르다).
const pickStartHere = (rows: readonly RiskMapFile[]): StartHerePick => {
  const candidates = rows.filter(
    (row) => row.points >= START_HERE_MIN_POINTS || row.mustFixCount > 0,
  );
  const startHere = candidates.slice(0, START_HERE_MAX);
  return {
    startHere,
    lowCount: rows.length - candidates.length,
    overflowCount: candidates.length - startHere.length,
  };
};

// 줄 단위 사유는 종류별로 접는다: 한 줄이면 "12줄 X", 여럿이면 "X ×3 (12·40·77줄)".
const summarizeReasons = (items: readonly RiskItem[]): string[] => {
  const plain = items
    .filter((item) => item.line === undefined)
    .map((item) => item.reason);
  const linesByReason = new Map<string, number[]>();
  for (const { reason, line } of items) {
    if (line !== undefined) {
      linesByReason.set(reason, [...(linesByReason.get(reason) ?? []), line]);
    }
  }
  const grouped = [...linesByReason].map(([reason, lines]) =>
    describeLines({ reason, lines }),
  );
  const reasons = [...plain, ...grouped];
  if (reasons.length <= MAX_REASONS_PER_FILE) {
    return reasons;
  }
  const hidden = reasons.length - MAX_REASONS_PER_FILE;
  return [...reasons.slice(0, MAX_REASONS_PER_FILE), `외 ${hidden}개`];
};

const describeLines = ({
  reason,
  lines,
}: {
  reason: string;
  lines: number[];
}): string => {
  if (lines.length === 1) {
    return `${lines[0]}줄 ${reason}`;
  }
  const shown = lines.slice(0, 3).join('·');
  const more = lines.length > 3 ? ' 외' : '';
  return `${reason} ×${lines.length} (${shown}줄${more})`;
};

const byPointsThenPath = (left: RiskMapFile, right: RiskMapFile): number => {
  if (left.points !== right.points) {
    return right.points - left.points;
  }
  if (left.path === right.path) {
    return 0;
  }
  return left.path < right.path ? -1 : 1;
};

const sizeShare = (lines: number): number =>
  Math.min(1, lines / SIZE_SATURATION_LINES);

// total 점을 count 개가 나눠 갖는 개별 점수 — count 개를 합치면 정확히 total 이 된다.
const sharedPoints = ({
  total,
  count,
}: {
  total: number;
  count: number;
}): number => {
  const remaining = (1 - total / 100) ** (1 / Math.max(1, count));
  return 100 * (1 - remaining);
};

const combine = (points: readonly number[]): number => {
  const survive = points.reduce((rest, point) => rest * (1 - point / 100), 1);
  return Math.round(100 * (1 - survive));
};
