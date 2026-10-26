import {
  ChangedFileStatus,
  PullRequestDetail,
  PullRequestDiff,
} from '../../../github/domain/github.type';
import { ReviewFinding } from './code-reviewer.type';
import { isCompanionTestPath, mapTestsToSources } from './companion-spec';
import { listAddedLines } from './diff-added-lines';

// 승인자용 위험 지도 — "이 PR 을 얼마나 꼼꼼히 봐야 하고, 어느 파일부터 봐야 하나".
//
// Farol(https://github.com/winnin/farol, MIT, src/report/merge-score.ts · verdict.ts)의 머지 위험 점수를
// 본떴다: 위험 항목마다 0~1 가중치를 매기고 1 − Π(1 − w) 로 합친다 — 각 항목이 따로 무언가를 깨뜨릴
// 확률을 합친 값이라 항목이 늘면 점수는 오르기만 한다. Farol 의 핵심 신호인 도달 범위(어느 화면·API 가
// 이 코드를 실행하나)는 체크아웃 + 언어별 컴파일러가 있어야 해서 뺐다. 여기 신호는 파일 경로·diff·
// `pulls.listFiles` 만으로 계산된다.
//
// 숫자는 이 파일의 코드만 정한다. LLM 은 관여하지 않는다 — 같은 PR 이면 같은 점수가 나와야 승인자가
// 점수를 기준으로 쓸 수 있다. 같은 회차의 리뷰 지적은 파일 옆에 건수로만 붙이고 점수에 넣지 않는다.
//
// ponytail: 가중치는 Farol 기본값과 이 레포 표본 몇 건으로 정한 초깃값이다. revert·fix 이력으로
// 보정하는 스크립트(Farol `calibrate`)가 붙기 전까지는 근거가 얕다.

export type RiskMapLevel = 'pass' | 'quick' | 'careful';

export type RiskFileRole =
  | 'code'
  | 'view'
  | 'test'
  | 'schema'
  | 'infra'
  | 'manifest'
  | 'lockfile'
  | 'env'
  | 'config'
  | 'doc'
  | 'other';

export const RISK_WEIGHT = {
  // 코드 파일: 고정분 + 바뀐 줄 수 비례분(SIZE_SATURATION_LINES 줄에서 상한).
  // 바뀐 줄로 키우는 이유: 작은 수정 여러 개가 쌓여 높은 점수가 되지 않게 한다.
  modifiedBase: 0.02,
  modifiedSize: 0.18,
  addedBase: 0.02,
  addedSize: 0.08,
  removedCode: 0.15,
  viewBase: 0.01,
  viewSize: 0.04,
  // 아래 셋은 PR 전체 합계 상한이다 — 파일이 여럿이면 나눠 갖는다(sharedWeight).
  schemaTotal: 0.35,
  infraTotal: 0.12,
  untestedTotal: 0.2,
  // 짝 테스트 없이 바뀐 파일 하나의 상한. 바뀐 줄 수에 비례해 여기까지 오른다 — 공유 몫만 쓰면
  // 해당 파일이 하나뿐일 때 2줄 수정이 상한 전체(20점)를 가져간다(표본 personal_agents#887).
  untestedFile: 0.15,
  manifest: 0.1,
  lockfile: 0.03,
  env: 0.05,
  config: 0.1,
  testRemoved: 0.1,
  testTrimmed: 0.05,
  testTouched: 0.02,
  suppression: 0.02,
  secret: 0.3,
  unknownFiles: 0.25,
} as const;

export const SIZE_SATURATION_LINES = 400;
export const TEST_TRIMMED_LINES = 10;
export const QUICK_SCORE = 25;
export const CAREFUL_SCORE = 60;
export const START_HERE_MAX = 7;
export const START_HERE_MIN_POINTS = 5;
// 짝 테스트 신호의 크기 비례분이 반 점(0.5/100)도 안 되면 싣지 않는다 — 2줄 수정에 붙으면 소음이다.
// 실린 뒤의 몫(공유 상한)으로는 거르지 않는다 — 거르면 파일이 늘수록 몫이 줄어 상한째 사라진다
// (예전 필터에서 CI 파일 25개는 12점, 26개는 0점이던 절벽).
export const MIN_ITEM_WEIGHT = 0.005;
// 파일 한 줄에 싣는 사유 상한. 억제 지시문 2000줄짜리 PR 의 본문이 GitHub 코멘트 한도를 넘지 않게 한다.
export const MAX_REASONS_PER_FILE = 6;

export interface RiskMapFile {
  path: string;
  role: RiskFileRole;
  // 이 파일만의 위험(0~100). 다른 파일과 무관하게 안정적이라 정렬 기준으로 쓴다.
  points: number;
  reasons: string[];
  findingCount: number;
  mustFixCount: number;
}

export interface RiskMap {
  level: RiskMapLevel;
  score: number;
  levelReasons: string[];
  startHere: RiskMapFile[];
  // 점수가 START_HERE_MIN_POINTS 미만이거나 상한 밖이라 목록에서 뺀 변경 파일 수.
  skimCount: number;
  // 계산이 무엇을 못 봤는지. 비어 있으면 입력 전체를 봤다.
  notes: string[];
}

export interface ComputeRiskMapInput {
  detail: Pick<
    PullRequestDetail,
    | 'changedFiles'
    | 'changedFilesTruncated'
    | 'changedFilesTotalCount'
    | 'changedLinesByFile'
    | 'changedFileStatsByFile'
  >;
  diff: Pick<PullRequestDiff, 'diff' | 'truncated'>;
  findings: ReviewFinding[];
}

interface RiskItem {
  file: string | null;
  weight: number;
  reason: string;
  // 같은 종류가 여러 줄에서 나오는 사유(억제 지시문·토큰). 파일 행에서 "×N" 으로 접는다.
  line?: number;
}

// 짝 테스트를 못 보는 언어도 코드로 센다 — 분류 밖(other)이면 5000줄 변경도 아무 표시 없이 0점이 된다.
const CODE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|php|py|go|java|kt|kts|rb|vue|svelte|graphql|gql|rs|cs|swift|c|cc|cpp|cxx|h|hpp|m|mm|scala|dart|sh|bash|lua|pl|ex|exs|erl|clj|fs)$/;
const VIEW_EXTENSION = /\.(?:html|scss|sass|css|less)$/;
// 짝 테스트 판정(companion-spec)이 지원하는 언어. 그 밖은 "판정 불가" 로 두고 점수에 넣지 않는다 —
// 모르는 것을 위험으로 치면 그 언어 PR 이 전부 높은 등급으로 쏠린다.
const PAIRABLE_SOURCE = /(?:\.[cm]?[jt]sx?|\.php)$/;
// 원래 테스트를 두지 않는 선언 파일(타입·enum·DTO·모듈 배선·포트·예외·상수). 여기에 짝 테스트 신호를
// 붙이면 작은 수정 PR 이 그것만으로 높은 등급이 된다(표본: personal_agents#887 이 enum·예외 파일로 29점).
// ponytail: 파일 이름 휴리스틱이다. Farol 은 AST 로 "선언만 바뀌었나"를 본다 — 이름 규칙이 다른 레포는 빠진다.
const DECLARATION_FILE =
  /\.d\.[cm]?ts$|\.(?:types?|enum|dto|module|port|exception|constants?|interface|token)\.[cm]?tsx?$|(?:^|\/)index\.[cm]?[jt]sx?$/;

// 순서가 우선순위다. 문서·테스트를 스키마보다 먼저 본다 — `docs/migrations/plan.md` 나 테스트 픽스처
// `.sql` 이 스키마로 잡혀 35점이 되지 않게. manifest 는 `requirements.txt` 가 문서(.txt)로 빠지지 않게 더 앞이다.
const ROLE_RULES: [RiskFileRole, RegExp][] = [
  [
    'lockfile',
    /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|composer\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock)$/,
  ],
  [
    'manifest',
    /(?:^|\/)(?:package\.json|composer\.json|go\.mod|pyproject\.toml|Pipfile|requirements[^/]*\.txt)$/,
  ],
  [
    'test',
    // 뒤 두 갈래는 XCTest·JUnit·xUnit 관례(`FooTests.swift`, `FooTest.java`, `ConsoleCoreTests/`) — Swift·Java 를
    // 코드로 세면서 테스트 파일이 코드로 잡히지 않게 한다(표본 personal_agents#881).
    /(?:^|\/)(?:__tests__|tests?|e2e)\/|\.(?:spec|test)\.[^/]+$|_test\.(?:go|py)$|(?:^|\/)(?:test_[^/]+\.py|conftest\.py)$|[A-Za-z0-9]Tests?\.(?:swift|kt|kts|java|cs|scala)$|(?:^|\/)[A-Za-z0-9]+Tests\//,
  ],
  ['doc', /\.(?:md|mdx|rst|adoc|txt)$|^docs\//i],
  ['schema', /(?:^|\/)schema\.prisma$|(?:^|\/)migrations?\/|\.sql$/i],
  ['env', /(?:^|\/)\.env(?:\.[^/]+)?$/],
  [
    'config',
    /(?:^|\/)(?:tsconfig[^/]*\.json|angular\.json|nest-cli\.json|nx\.json|project\.json|eslint\.config\.[^/]+|\.eslintrc[^/]*|jest\.config\.[^/]+|vite\.config\.[^/]+|webpack\.config\.[^/]+)$/,
  ],
  [
    'infra',
    /^\.github\/workflows\/|(?:^|\/)Dockerfile[^/]*$|(?:^|\/)docker-compose[^/]*\.ya?ml$|(?:^|\/)(?:k8s|kubernetes|helm|charts|deploy|deployment|infra|infrastructure|terraform)\/|\.tf$|(?:^|\/)(?:Jenkinsfile|Procfile)$/,
  ],
];

export const classifyRiskFileRole = (path: string): RiskFileRole => {
  if (isCompanionTestPath(path)) {
    return 'test';
  }
  for (const [role, pattern] of ROLE_RULES) {
    // 소스 코드는 어느 폴더에 있든 인프라가 아니다(Farol roles.ts:13-20 과 같은 규칙).
    if (role === 'infra' && CODE_EXTENSION.test(path)) {
      continue;
    }
    if (pattern.test(path)) {
      return role;
    }
  }
  if (CODE_EXTENSION.test(path)) {
    return 'code';
  }
  if (VIEW_EXTENSION.test(path)) {
    return 'view';
  }
  return 'other';
};

// 주석 안의 억제 지시문만 센다. 주석 기호가 줄 처음이나 공백 뒤에 와야 한다 — `'// eslint-disable'`
// 같은 문자열 리터럴은 따옴표 뒤라 걸리지 않는다.
const SUPPRESSION =
  /(?:^|\s)(?:\/\/|\/\*|#|\*)\s*(eslint-disable(?:-next-line|-line)?|@ts-(?:ignore|expect-error|nocheck)|phpcs:(?:ignore|disable)|@phpstan-ignore[\w-]*|noqa|type:\s*ignore|nolint|istanbul ignore|c8 ignore)\b/;

// 잘 알려진 공급자의 토큰 형식(Farol signals/security.ts:12-21). 이 형식의 리터럴은 유출된 자격증명이다.
// 앞에 식별자 문자가 붙으면 토큰이 아니다 — `disk-space-…`·`task-list-…` 안의 `sk-` 가 키로 잡히던 오탐.
const TOKEN_START = '(?<![A-Za-z0-9_-])';
const TOKEN_FORMATS: [RegExp, string][] = [
  [new RegExp(`${TOKEN_START}AKIA[0-9A-Z]{16}`, 'g'), 'AWS access key'],
  [new RegExp(`${TOKEN_START}gh[pousr]_[A-Za-z0-9]{36,}`, 'g'), 'GitHub 토큰'],
  [
    new RegExp(`${TOKEN_START}github_pat_[A-Za-z0-9_]{50,}`, 'g'),
    'GitHub fine-grained 토큰',
  ],
  [
    new RegExp(`${TOKEN_START}xox[abposr]-[A-Za-z0-9-]{10,}`, 'g'),
    'Slack 토큰',
  ],
  [new RegExp(`${TOKEN_START}sk_live_[A-Za-z0-9]{20,}`, 'g'), 'Stripe live 키'],
  [
    new RegExp(
      `${TOKEN_START}sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{32,}`,
      'g',
    ),
    'OpenAI·Anthropic 형식 키',
  ],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, '개인 키'],
  [
    new RegExp(
      `${TOKEN_START}eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`,
      'g',
    ),
    'JWT',
  ],
];
// 공급자 문서의 예시 키(AWS `AKIAIOSFODNN7EXAMPLE` 등)는 엔트로피가 높아 따로 거른다.
const EXAMPLE_TOKEN = /EXAMPLE/i;
// `ghp_xxxx…` 같은 문서 예시를 거른다. 무작위 토큰은 문자당 엔트로피가 높다.
const MIN_TOKEN_ENTROPY = 3;

const entropy = (text: string): number => {
  const counts = new Map<string, number>();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const share = count / text.length;
    bits -= share * Math.log2(share);
  }
  return bits;
};

// 같은 형식의 모든 일치를 본다 — 첫 일치만 보면 같은 줄의 예시 토큰 뒤에 온 진짜 토큰을 놓친다.
const findLeakedToken = (text: string): string | undefined => {
  for (const [pattern, label] of TOKEN_FORMATS) {
    for (const match of text.matchAll(pattern)) {
      if (label === '개인 키') {
        return label;
      }
      if (
        entropy(match[0]) >= MIN_TOKEN_ENTROPY &&
        !EXAMPLE_TOKEN.test(match[0])
      ) {
        return label;
      }
    }
  }
  return undefined;
};

const sizeShare = (lines: number): number =>
  Math.min(1, lines / SIZE_SATURATION_LINES);

// 합계 상한 `total` 을 n 개가 나눠 갖는 개별 가중치 — n 개를 다 합치면 정확히 total 이 된다.
const sharedWeight = (total: number, count: number): number =>
  1 - (1 - total) ** (1 / Math.max(1, count));

const combine = (weights: readonly number[]): number =>
  Math.round(
    100 * (1 - weights.reduce((rest, weight) => rest * (1 - weight), 1)),
  );

const STATUS_LABEL: Record<ChangedFileStatus, string> = {
  added: '신규',
  removed: '삭제',
  modified: '수정',
  renamed: '이름 변경',
};

const changeItem = (
  path: string,
  role: RiskFileRole,
  status: ChangedFileStatus,
  lines: number,
): RiskItem | null => {
  const label = `${STATUS_LABEL[status]} ${lines}줄`;
  if (role === 'code') {
    if (status === 'removed') {
      return {
        file: path,
        weight: RISK_WEIGHT.removedCode,
        reason: '코드 파일 삭제',
      };
    }
    const [base, size] =
      status === 'added'
        ? [RISK_WEIGHT.addedBase, RISK_WEIGHT.addedSize]
        : [RISK_WEIGHT.modifiedBase, RISK_WEIGHT.modifiedSize];
    return {
      file: path,
      weight: base + size * sizeShare(lines),
      reason: label,
    };
  }
  if (role === 'view') {
    return {
      file: path,
      weight: RISK_WEIGHT.viewBase + RISK_WEIGHT.viewSize * sizeShare(lines),
      reason: `화면 템플릿·스타일 ${label}`,
    };
  }
  if (role === 'manifest') {
    return {
      file: path,
      weight: RISK_WEIGHT.manifest,
      reason: '의존성 선언 변경',
    };
  }
  if (role === 'lockfile') {
    return {
      file: path,
      weight: RISK_WEIGHT.lockfile,
      reason: '잠금 파일 변경',
    };
  }
  if (role === 'env') {
    return {
      file: path,
      weight: RISK_WEIGHT.env,
      reason: '환경 변수 정의 변경 — 배포 환경마다 확인',
    };
  }
  if (role === 'config') {
    return {
      file: path,
      weight: RISK_WEIGHT.config,
      reason: '빌드·도구 설정 변경 — 전체에 영향',
    };
  }
  return null;
};

// 순감(삭제 − 추가)으로 본다. 삭제 줄 수만 보면 테스트를 다시 쓰며 늘린 PR 이 "축소" 로 잡힌다
// (표본: +246/-16, +99/-42 가 둘 다 걸렸다).
const testItem = (
  path: string,
  status: ChangedFileStatus,
  additions: number,
  deletions: number,
): RiskItem | null => {
  if (status === 'removed') {
    return {
      file: path,
      weight: RISK_WEIGHT.testRemoved,
      reason: '기존 테스트 파일 삭제',
    };
  }
  const shrunk = deletions - additions;
  if (status === 'added' || shrunk <= 0) {
    return null;
  }
  return {
    file: path,
    weight:
      shrunk >= TEST_TRIMMED_LINES
        ? RISK_WEIGHT.testTrimmed
        : RISK_WEIGHT.testTouched,
    reason: `기존 테스트 ${shrunk}줄 순감`,
  };
};

export const computeRiskMap = ({
  detail,
  diff,
  findings,
}: ComputeRiskMapInput): RiskMap => {
  const stats = detail.changedFileStatsByFile;
  const roles = new Map(
    detail.changedFiles.map((path) => [path, classifyRiskFileRole(path)]),
  );
  const statusOf = (path: string): ChangedFileStatus =>
    stats?.[path]?.status ?? 'modified';
  const items: RiskItem[] = [];
  const notes: string[] = [];
  let testsCut = false;

  for (const path of detail.changedFiles) {
    const role = roles.get(path) ?? 'other';
    const item = changeItem(
      path,
      role,
      statusOf(path),
      detail.changedLinesByFile[path] ?? 0,
    );
    if (item !== null) {
      items.push(item);
    }
    if (role === 'test' && stats?.[path] !== undefined) {
      const { status, deletions } = stats[path];
      const additions = (detail.changedLinesByFile[path] ?? 0) - deletions;
      const trimmed = testItem(path, status, additions, deletions);
      if (trimmed !== null) {
        items.push(trimmed);
        testsCut ||= trimmed.weight >= RISK_WEIGHT.testTrimmed;
      }
    }
  }

  const pathsWith = (role: RiskFileRole): string[] =>
    detail.changedFiles.filter((path) => roles.get(path) === role);
  const schemaFiles = pathsWith('schema');
  for (const path of schemaFiles) {
    items.push({
      file: path,
      weight: sharedWeight(RISK_WEIGHT.schemaTotal, schemaFiles.length),
      reason: 'DB 스키마·마이그레이션 변경 — 데이터 유실·배포 순서 확인',
    });
  }
  const infraFiles = pathsWith('infra');
  for (const path of infraFiles) {
    items.push({
      file: path,
      weight: sharedWeight(RISK_WEIGHT.infraTotal, infraFiles.length),
      reason: '배포·CI 설정 변경 — 환경마다 확인',
    });
  }

  // 짝 테스트: 이 PR 에서 함께 고친 테스트만 본다(트리 조회 없음). 테스트가 원래 없는 소스와
  // 고칠 필요가 없었던 소스를 가르지 못해 개별 가중치를 낮게 두고 합계 상한을 건다.
  // 이 PR 에서 지운 테스트는 짝으로 치지 않는다 — 지운 것을 "함께 고쳤다" 로 읽으면 소스의 테스트 신호가 사라진다.
  const testedInPr = mapTestsToSources(
    detail.changedFiles.filter((path) => statusOf(path) !== 'removed'),
  );
  const untested: string[] = [];
  let unpairable = 0;
  for (const path of pathsWith('code')) {
    if (statusOf(path) === 'removed' || DECLARATION_FILE.test(path)) {
      continue;
    }
    if (!PAIRABLE_SOURCE.test(path)) {
      unpairable += 1;
      continue;
    }
    if (!testedInPr.has(path)) {
      untested.push(path);
    }
  }
  // 크기 비례분이 반 점도 안 되면 싣지 않는다(몇 줄짜리 수정의 소음). 실었으면 공유 몫이 더 작아도
  // 남긴다 — 파일 수가 많을 때 상한째 사라지지 않게.
  for (const path of untested) {
    const bySize =
      RISK_WEIGHT.untestedFile *
      sizeShare(detail.changedLinesByFile[path] ?? 0);
    if (bySize < MIN_ITEM_WEIGHT) {
      continue;
    }
    items.push({
      file: path,
      weight: Math.min(
        sharedWeight(RISK_WEIGHT.untestedTotal, untested.length),
        bySize,
      ),
      reason: '이 PR 에서 짝 테스트를 고치지 않음',
    });
  }

  let secretFound = false;
  for (const { file, line, text } of listAddedLines(diff.diff)) {
    const role = roles.get(file) ?? classifyRiskFileRole(file);
    if (role !== 'test' && role !== 'doc') {
      const suppression = SUPPRESSION.exec(text);
      if (suppression) {
        items.push({
          file,
          weight: RISK_WEIGHT.suppression,
          reason: `\`${suppression[1]}\` 추가`,
          line,
        });
      }
    }
    const token = findLeakedToken(text);
    if (token !== undefined) {
      secretFound = true;
      items.push({
        file,
        weight: RISK_WEIGHT.secret,
        reason: `${token} 형식 문자열 — 유출 여부 확인`,
        line,
      });
    }
  }

  if (detail.changedFilesTruncated) {
    items.push({
      file: null,
      weight: RISK_WEIGHT.unknownFiles,
      reason: '변경 파일 목록이 잘려 일부 파일을 보지 못함',
    });
    notes.push(
      `변경 파일 ${detail.changedFilesTotalCount}개 중 ${detail.changedFiles.length}개만 분석했습니다.`,
    );
  }
  if (diff.truncated) {
    notes.push(
      'diff 가 잘려 추가 줄 검사(억제 지시문·토큰 형식)는 앞부분만 봤습니다.',
    );
  }
  if (stats === undefined) {
    notes.push(
      '파일별 변경 종류를 받지 못해 모두 수정으로 보고, 테스트 삭제는 보지 않았습니다.',
    );
  }
  if (unpairable > 0) {
    notes.push(
      `짝 테스트를 판정하지 못한 코드 파일 ${unpairable}개(JS·TS·PHP 밖)는 테스트 신호를 빼고 계산했습니다.`,
    );
  }

  const score = combine(items.map((item) => item.weight));
  const level = decideLevel({
    score,
    secretFound,
    schemaChanged: schemaFiles.length > 0,
    infraChanged: infraFiles.length > 0,
    filesTruncated: detail.changedFilesTruncated,
    testsCut,
  });

  const files = buildFileRows(detail.changedFiles, roles, items, findings);
  const startHere = files
    .filter((file) => file.points >= START_HERE_MIN_POINTS)
    .slice(0, START_HERE_MAX);

  return {
    level: level.level,
    score,
    levelReasons: level.reasons,
    startHere,
    skimCount: detail.changedFiles.length - startHere.length,
    notes,
  };
};

export interface LevelInput {
  score: number;
  secretFound: boolean;
  schemaChanged: boolean;
  infraChanged: boolean;
  filesTruncated: boolean;
  testsCut: boolean;
}

export interface LevelDecision {
  level: RiskMapLevel;
  reasons: string[];
}

// 점수 말고도 그것만으로 등급을 올리는 사유가 있다(Farol verdict.ts:112-146 과 같은 구조).
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
    return { level: 'careful', reasons: [...careful, ...quick] };
  }
  if (quick.length > 0) {
    return { level: 'quick', reasons: quick };
  }
  return {
    level: 'pass',
    reasons: [
      `위험 점수 ${input.score}/100 — 넓게 영향을 줄 변경이 보이지 않음`,
    ],
  };
};

// 줄 단위 사유는 종류별로 접는다: 한 줄이면 "12줄 X", 여럿이면 "X ×3 (12·40·77줄)". 그래도 많으면 자른다.
const summarizeReasons = (items: readonly RiskItem[]): string[] => {
  const plain: string[] = [];
  const linesByReason = new Map<string, number[]>();
  for (const item of items) {
    if (item.line === undefined) {
      plain.push(item.reason);
      continue;
    }
    linesByReason.set(item.reason, [
      ...(linesByReason.get(item.reason) ?? []),
      item.line,
    ]);
  }
  const grouped = [...linesByReason].map(([reason, lines]) => {
    if (lines.length === 1) {
      return `${lines[0]}줄 ${reason}`;
    }
    const shown = lines.slice(0, 3).join('·');
    const more = lines.length > 3 ? ' 외' : '';
    return `${reason} ×${lines.length} (${shown}줄${more})`;
  });
  const reasons = [...plain, ...grouped];
  if (reasons.length <= MAX_REASONS_PER_FILE) {
    return reasons;
  }
  return [
    ...reasons.slice(0, MAX_REASONS_PER_FILE),
    `외 ${reasons.length - MAX_REASONS_PER_FILE}개`,
  ];
};

const buildFileRows = (
  paths: readonly string[],
  roles: ReadonlyMap<string, RiskFileRole>,
  items: readonly RiskItem[],
  findings: readonly ReviewFinding[],
): RiskMapFile[] =>
  paths
    .map((path) => {
      const own = items.filter((item) => item.file === path);
      const fileFindings = findings.filter((finding) => finding.file === path);
      return {
        path,
        role: roles.get(path) ?? 'other',
        points: combine(own.map((item) => item.weight)),
        reasons: summarizeReasons(own),
        findingCount: fileFindings.length,
        mustFixCount: fileFindings.filter(
          (finding) => finding.severity === 'MUST_FIX',
        ).length,
      };
    })
    .sort(
      (left, right) =>
        right.points - left.points ||
        (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    );
