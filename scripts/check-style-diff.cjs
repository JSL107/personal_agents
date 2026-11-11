'use strict';
// PR 전 스타일 검사 — owner 리뷰에서 반복 지적된 모양을 "이번 브랜치에서 추가된 줄"에서만 찾는다.
// 레포 전체에 걸면 기존 코드 약 5,000건이 한꺼번에 걸리므로(2026-11-11 실측) diff 범위로 좁힌다.
// ERROR 는 exit 1, WARN 은 출력만 한다. 의도한 예외는 `// eslint-disable-next-line no-restricted-syntax -- 이유`.
//
// 사용: node scripts/check-style-diff.cjs [--base <rev>] [--head <rev>]
//   --base 생략 시 merge-base(HEAD, origin/main). --head 생략 시 작업 트리(커밋 안 한 변경·새 파일 포함).
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { ESLint } = require('eslint');

const Severity = Object.freeze({ ERROR: 'ERROR', WARN: 'WARN' });

const FUNCTION =
  ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)';
// 프레임워크 인터페이스가 인자 순서를 강제하는 메서드 (CODE_RULES §3-11 예외).
const POSITIONAL_EXEMPT_METHODS = '/^(catch|intercept|transform|use)$/';

const STYLE_RULES = [
  {
    id: 'positional-args',
    severity: Severity.ERROR,
    selector: `${FUNCTION}[params.length>=2]:not(CallExpression > ${FUNCTION}):not(NewExpression > ${FUNCTION}):not(MethodDefinition[kind='constructor'] > FunctionExpression):not(MethodDefinition[key.name=${POSITIONAL_EXEMPT_METHODS}] > FunctionExpression)`,
    message:
      '인자가 둘 이상이면 객체 구조 분해로 받는다 — ({ a, b }) (CODE_RULES §3-11)',
  },
  {
    id: 'literal-union',
    severity: Severity.ERROR,
    selector: 'TSUnionType:has(> TSLiteralType)',
    message: '문자열·숫자 리터럴 나열 타입 대신 enum 을 쓴다 (CODE_RULES §1-9)',
  },
  {
    id: 'as-const-object',
    severity: Severity.ERROR,
    selector:
      "TSAsExpression[typeAnnotation.typeName.name='const'] > ObjectExpression",
    message:
      '객체에 as const 를 붙이지 않는다 — 상태값은 enum, 그 밖은 명시 타입 (CODE_RULES §1-9)',
  },
  {
    id: 'intersection-type',
    severity: Severity.ERROR,
    selector: 'TSIntersectionType',
    message:
      '& 로 타입을 확장하지 않는다 — interface 가 extends 한다 (CODE_RULES §3-8)',
  },
  {
    id: 'nested-record',
    severity: Severity.ERROR,
    selector:
      "TSTypeReference[typeName.name='Record'] TSTypeReference[typeName.name='Record']",
    message:
      'Record 를 중첩하지 않는다 — 안쪽 타입에 이름을 붙여 뺀다 (CODE_RULES §3-8)',
  },
  {
    id: 'function-type-alias',
    severity: Severity.ERROR,
    selector: 'TSTypeAliasDeclaration > TSFunctionType',
    message:
      '함수 타입 별칭을 만들지 않는다 — 라이브러리 타입을 쓰거나 interface 로 (CODE_RULES §3-8)',
  },
  {
    id: 'inline-return-type',
    severity: Severity.ERROR,
    selector: `${FUNCTION} > TSTypeAnnotation.returnType TSTypeLiteral`,
    message:
      '반환 타입을 인라인 객체로 쓰지 않는다 — type/interface 로 뺀다 (CODE_RULES §3-7)',
  },
  {
    id: 'return-ternary-call',
    severity: Severity.ERROR,
    // 조건식의 호출은 허용한다(§1-1 은 갈래만 본다) — 갈래 자신이나 갈래 안쪽만 찾는다.
    selector:
      'ReturnStatement > ConditionalExpression > :matches(.consequent, .alternate):matches(CallExpression, TemplateLiteral), ReturnStatement > ConditionalExpression > :matches(.consequent, .alternate) :matches(CallExpression, TemplateLiteral)',
    message:
      'return 의 삼항 갈래에 호출·템플릿을 넣지 않는다 — const 로 받거나 early return (CODE_RULES §1-1)',
  },
  {
    id: 'return-object-ternary',
    severity: Severity.ERROR,
    selector:
      'ReturnStatement > ObjectExpression > Property > ConditionalExpression',
    message:
      'return 하는 객체 안에서 삼항으로 분기하지 않는다 — return 전에 const 로 (CODE_RULES §1-1)',
  },
  {
    id: 'return-chain',
    severity: Severity.ERROR,
    selector:
      'ReturnStatement > CallExpression > MemberExpression > CallExpression',
    message:
      'return 에 메서드 체이닝 2단계 이상을 쓰지 않는다 — const 로 받은 뒤 return (CODE_RULES §1-1)',
  },
  {
    id: 'let',
    severity: Severity.ERROR,
    selector: "VariableDeclaration[kind='let']",
    message: 'let 대신 const 와 표준 함수(parseArgs·map·reduce 등)로 푼다',
  },
  {
    id: 'index-for',
    severity: Severity.ERROR,
    selector: 'ForStatement',
    message: '인덱스 for 문 대신 for...of·배열 메서드를 쓴다',
  },
  {
    id: 'inline-param-type',
    severity: Severity.WARN,
    selector: `${FUNCTION} > Identifier.params > TSTypeAnnotation > TSTypeLiteral`,
    message:
      '인자 타입을 인라인 객체로 쓰기보다 type/interface 로 뺀다 (CODE_RULES §3-7)',
  },
  {
    id: 'return-call-in-call',
    severity: Severity.WARN,
    selector:
      'ReturnStatement > CallExpression CallExpression:not(ArrowFunctionExpression CallExpression)',
    message:
      'return 하는 호출의 인자 안에서 다시 계산하지 않는다 — const 로 먼저 받는다 (CODE_RULES §1-1)',
  },
  {
    id: 'ternary-call-branch',
    severity: Severity.WARN,
    selector:
      "ConditionalExpression:not([test.operator='instanceof']) > CallExpression.consequent, ConditionalExpression:not([test.operator='instanceof']) > CallExpression.alternate",
    message:
      '삼항 갈래에 호출이 들어가면 if 나 이름 붙인 함수로 푸는 편이 읽기 쉽다',
  },
  {
    id: 'complex-if',
    severity: Severity.WARN,
    selector: 'IfStatement > LogicalExpression.test:has(> LogicalExpression)',
    message:
      'if 조건에 3개 이상을 몰지 않는다 — 이름 붙인 함수나 early return 으로',
  },
  {
    id: 'if-test-callback',
    severity: Severity.WARN,
    selector: 'IfStatement > .test ArrowFunctionExpression',
    message: 'if 조건 안에서 콜백으로 계산하지 않는다 — 이름 붙인 함수로 뺀다',
  },
  {
    id: 'type-guard',
    severity: Severity.WARN,
    selector: 'TSTypePredicate',
    message:
      '`x is T` 타입 가드가 꼭 필요한지 — enum 이면 Object.values(...).find 로 좁힐 수 있다',
  },
  {
    id: 'iso-date-slice',
    severity: Severity.WARN,
    selector:
      "CallExpression[callee.property.name='slice'][callee.object.callee.property.name='toISOString']",
    message:
      '날짜 문자열은 src/common/util/kst-date.util.ts 에 있는 함수부터 찾는다',
  },
  {
    id: 'type-alias-object',
    severity: Severity.WARN,
    selector: 'TSTypeAliasDeclaration > TSTypeLiteral',
    message: '코드 파일 안에서 객체 타입을 선언하기보다 *.type.ts 로 모은다',
    skipFile: (file) => file.endsWith('.type.ts'),
  },
  {
    id: 'abbreviated-name',
    severity: Severity.WARN,
    selector:
      'VariableDeclarator > Identifier.id[name=/^(existing|repo|req|res|err)$/], :matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) > Identifier.params[name=/^(existing|repo|req|res|err)$/]',
    message: '줄임말·진행형 변수명을 쓰지 않는다 (CODE_RULES §4 변수 네이밍)',
  },
];

const RULE_BY_ID = new Map(STYLE_RULES.map((rule) => [rule.id, rule]));

const isTargetFile = (file) =>
  /^(src|scripts|test)\/.*\.ts$/.test(file) &&
  !/\.(spec|e2e-spec)\.ts$/.test(file) &&
  !/^scripts\/__/.test(file);

// `git diff -U0` 출력에서 파일별로 추가된 줄 번호를 모은다.
// `+++ ` 는 `diff --git` 과 첫 `@@` 사이에서만 파일 헤더다 — 본문의 추가 줄 `++ x` 도 `+++ x` 로 찍힌다.
const parseAddedLines = (diffText) => {
  const added = new Map();
  const hunkPattern = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/;
  const state = { file: null, inHeader: false };
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      state.inHeader = true;
      continue;
    }
    if (state.inHeader && line.startsWith('+++ ')) {
      state.file = line.startsWith('+++ b/')
        ? line.slice('+++ b/'.length)
        : null;
      if (state.file) {
        added.set(state.file, new Set());
      }
      continue;
    }
    const hunk = hunkPattern.exec(line);
    if (!hunk || !state.file) {
      continue;
    }
    state.inHeader = false;
    const start = Number(hunk[1]);
    const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
    Array.from({ length: count }, (_, offset) => start + offset).forEach(
      (lineNumber) => added.get(state.file).add(lineNumber),
    );
  }
  return added;
};

const createLinter = (root) =>
  new ESLint({
    cwd: root,
    useEslintrc: false,
    overrideConfig: {
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: {
        'no-restricted-syntax': [
          'error',
          ...STYLE_RULES.map((rule) => ({
            selector: rule.selector,
            message: rule.id,
          })),
        ],
      },
    },
  });

// 한 파일의 추가된 줄에서 나온 위반만 돌려준다. lines 가 null 이면 파일 전체.
// shortcut: 노드의 시작 줄로만 판정해 기존 여러 줄 함수 시그니처 중간에 인자를 더한 경우는 놓친다, 그 사례가 리뷰에서 나오면 노드 범위와 추가 줄의 교집합으로 바꾼다.
const lintSource = async ({ linter, root, file, source, lines }) => {
  const [result] = await linter.lintText(source, {
    filePath: path.join(root, file),
  });
  return result.messages
    .filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' &&
        RULE_BY_ID.has(message.message),
    )
    .filter((message) => lines === null || lines.has(message.line))
    .map((message) => ({
      file,
      line: message.line,
      rule: RULE_BY_ID.get(message.message),
    }))
    .filter((violation) => !violation.rule.skipFile?.(file));
};

const git = ({ root, args }) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
  });

const resolveBase = ({ root, base }) => {
  if (base) {
    return base;
  }
  const upstream = ['origin/main', 'main'].find((ref) => {
    try {
      git({ root, args: ['rev-parse', '--verify', '--quiet', ref] });
      return true;
    } catch {
      return false;
    }
  });
  return git({ root, args: ['merge-base', 'HEAD', upstream] }).trim();
};

// 검사 대상: { file, lines, read } 목록. head 가 없으면 작업 트리와 아직 추적 안 된 새 파일까지 본다.
const collectTargets = ({ root, base, head }) => {
  const range = head ? [base, head] : [base];
  const diff = git({
    root,
    args: [
      'diff',
      '-U0',
      '--no-renames',
      '--diff-filter=AM',
      ...range,
      '--',
      '*.ts',
    ],
  });
  const read = (file) =>
    head
      ? git({ root, args: ['show', `${head}:${file}`] })
      : fs.readFileSync(path.join(root, file), 'utf8');
  const tracked = [...parseAddedLines(diff)].map(([file, lines]) => ({
    file,
    lines,
    read,
  }));
  const untracked = head
    ? []
    : git({
        root,
        args: ['ls-files', '--others', '--exclude-standard', '--', '*.ts'],
      })
        .split('\n')
        .filter((file) => file.length > 0)
        .map((file) => ({ file, lines: null, read }));
  return [...tracked, ...untracked].filter((target) =>
    isTargetFile(target.file),
  );
};

const checkStyleDiff = async ({ root, base, head }) => {
  const linter = createLinter(root);
  const resolvedBase = resolveBase({ root, base });
  const targets = collectTargets({ root, base: resolvedBase, head });
  const perFile = await Promise.all(
    targets.map((target) =>
      lintSource({
        linter,
        root,
        file: target.file,
        source: target.read(target.file),
        lines: target.lines,
      }),
    ),
  );
  return {
    base: resolvedBase,
    fileCount: targets.length,
    violations: perFile.flat(),
  };
};

module.exports = {
  Severity,
  STYLE_RULES,
  parseAddedLines,
  createLinter,
  lintSource,
  checkStyleDiff,
};

if (require.main === module) {
  const { values } = parseArgs({
    options: { base: { type: 'string' }, head: { type: 'string' } },
  });
  const root = path.resolve(__dirname, '..');
  checkStyleDiff({ root, base: values.base, head: values.head }).then(
    ({ base, fileCount, violations }) => {
      const errors = violations.filter(
        (violation) => violation.rule.severity === Severity.ERROR,
      );
      for (const violation of violations) {
        const log =
          violation.rule.severity === Severity.ERROR
            ? console.error
            : console.warn;
        log(
          `${violation.rule.severity} ${violation.file}:${violation.line} [${violation.rule.id}] ${violation.rule.message}`,
        );
      }
      const summary = `스타일 검사: 기준 ${base.slice(0, 8)}, 파일 ${fileCount}개, 오류 ${errors.length} · 경고 ${violations.length - errors.length}`;
      if (errors.length > 0) {
        console.error(
          `${summary}\n예외가 정당하면 // eslint-disable-next-line no-restricted-syntax -- 이유`,
        );
        process.exit(1);
      }
      console.log(summary);
    },
  );
}
