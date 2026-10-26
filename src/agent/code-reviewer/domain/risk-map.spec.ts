import { ChangedFileStat } from '../../../github/domain/github.type';
import { ReviewFinding } from './code-reviewer.type';
import {
  CAREFUL_SCORE,
  computeRiskMap,
  decideLevel,
  MAX_REASONS_PER_FILE,
  QUICK_SCORE,
  START_HERE_MAX,
} from './risk-map';
import { ComputeRiskMapInput, LevelInput, RiskMapLevel } from './risk-map.type';

interface FileFixture {
  path: string;
  lines?: number;
  status?: ChangedFileStat['status'];
  deletions?: number;
  added?: string[];
}

// 파일 목록과 추가 줄로 리뷰 입력을 만든다. 추가 줄이 없으면 diff 에 넣지 않는다.
const buildInput = (
  files: FileFixture[],
  options: {
    findings?: ReviewFinding[];
    withStats?: boolean;
    filesTruncated?: boolean;
    diffTruncated?: boolean;
  } = {},
): ComputeRiskMapInput => {
  const diff = files
    .filter((file) => file.added !== undefined && file.added.length > 0)
    .map((file) => {
      const added = file.added ?? [];
      return [
        `diff --git a/${file.path} b/${file.path}`,
        `--- a/${file.path}`,
        `+++ b/${file.path}`,
        `@@ -1,0 +1,${added.length} @@`,
        ...added.map((line) => `+${line}`),
      ].join('\n');
    })
    .join('\n');
  return {
    detail: {
      changedFiles: files.map((file) => file.path),
      changedFilesTruncated: options.filesTruncated ?? false,
      changedFilesTotalCount: files.length + (options.filesTruncated ? 10 : 0),
      changedLinesByFile: Object.fromEntries(
        files.map((file) => [file.path, file.lines ?? 10]),
      ),
      changedFileStatsByFile:
        options.withStats === false
          ? undefined
          : Object.fromEntries(
              files.map((file) => [
                file.path,
                {
                  status: file.status ?? 'modified',
                  deletions: file.deletions ?? 0,
                },
              ]),
            ),
    },
    diff: { diff, truncated: options.diffTruncated ?? false },
    findings: options.findings ?? [],
  };
};

// 토큰 형식 문자열은 실행 시점에 조립한다 — 소스에 리터럴로 두면 비밀 스캐너가 이 파일을 막는다.
const fakeGithubToken = (): string => `gh${'p'}_${'a1B2c3D4e5F6'.repeat(3)}`;

describe('computeRiskMap', () => {
  it('문서만 바꾼 PR 은 위험 신호가 적다', () => {
    const map = computeRiskMap(
      buildInput([{ path: 'README.md', lines: 200 }, { path: 'docs/a.md' }]),
    );

    expect(map.level).toBe(RiskMapLevel.PASS);
    expect(map.score).toBe(0);
    expect(map.startHere).toEqual([]);
    expect(map.lowCount).toBe(2);
  });

  it('스키마 변경은 점수와 무관하게 가볍게 확인 이상이고 목록 맨 위에 온다', () => {
    const map = computeRiskMap(
      buildInput([
        { path: 'prisma/schema.prisma', lines: 4 },
        { path: 'src/a.ts', lines: 4 },
        { path: 'src/a.spec.ts', lines: 4 },
      ]),
    );

    expect(map.level).toBe(RiskMapLevel.QUICK);
    expect(map.levelReasons).toContain('DB 스키마·마이그레이션 변경');
    expect(map.startHere[0].path).toBe('prisma/schema.prisma');
  });

  it('작은 수정이 많이 쌓여도 꼼꼼히 확인까지 가지 않는다', () => {
    const files = Array.from({ length: 20 }, (_, index) => ({
      path: `src/feature/file-${index}.ts`,
      lines: 5,
    }));
    files.push(
      ...files.map((file) => ({
        path: file.path.replace('.ts', '.spec.ts'),
        lines: 5,
      })),
    );

    const map = computeRiskMap(buildInput(files));

    expect(map.score).toBeLessThan(CAREFUL_SCORE);
    expect(map.level).not.toBe(RiskMapLevel.CAREFUL);
  });

  it('큰 코드 변경은 위험 점수만으로 꼼꼼히 확인이 된다', () => {
    const files = Array.from({ length: 6 }, (_, index) => ({
      path: `src/core/module-${index}.ts`,
      lines: 400,
    }));

    const map = computeRiskMap(buildInput(files));

    expect(map.score).toBeGreaterThanOrEqual(CAREFUL_SCORE);
    expect(map.level).toBe(RiskMapLevel.CAREFUL);
    expect(map.startHere.length).toBeLessThanOrEqual(START_HERE_MAX);
  });

  it('추가된 줄의 자격증명 형식 문자열은 점수와 무관하게 꼼꼼히 확인이다', () => {
    const map = computeRiskMap(
      buildInput([
        {
          path: 'src/config.ts',
          lines: 1,
          added: [`const token = '${fakeGithubToken()}';`],
        },
      ]),
    );

    expect(map.level).toBe(RiskMapLevel.CAREFUL);
    expect(map.levelReasons).toContain('추가된 줄에 자격증명 형식 문자열');
    expect(map.startHere[0].reasons).toContain(
      '1줄 GitHub 토큰 형식 문자열 — 유출 여부 확인',
    );
  });

  it('반복 문자로 된 문서 예시 토큰은 유출로 보지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        {
          path: 'src/config.ts',
          lines: 1,
          added: [`// 예: gh${'p'}_${'x'.repeat(36)}`],
        },
      ]),
    );

    expect(map.level).not.toBe(RiskMapLevel.CAREFUL);
  });

  it('억제 지시문은 코드에서만 세고 테스트·문서에서는 세지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        {
          path: 'src/a.ts',
          added: [
            '// eslint-disable-next-line no-console',
            'run(); // @ts-ignore',
          ],
        },
        { path: 'src/a.spec.ts', added: ['// @ts-expect-error 의도된 오류'] },
        { path: 'docs/lint.md', added: ['# noqa 를 쓰지 마세요'] },
      ]),
    );

    const reasons = map.startHere.flatMap((file) => file.reasons);
    expect(reasons).toContain('1줄 `eslint-disable-next-line` 추가');
    expect(reasons).toContain('2줄 `@ts-ignore` 추가');
  });

  it('테스트·문서의 억제 지시문은 점수에 넣지 않는다', () => {
    const many = Array.from({ length: 30 }, () => '// @ts-expect-error');
    const withLines = computeRiskMap(
      buildInput([
        { path: 'src/a.spec.ts', added: many },
        { path: 'docs/lint.md', added: many },
      ]),
    );
    const without = computeRiskMap(
      buildInput([{ path: 'src/a.spec.ts' }, { path: 'docs/lint.md' }]),
    );

    expect(withLines.score).toBe(without.score);
  });

  it('사유는 파일당 상한까지만 싣고 나머지는 개수로 적는다', () => {
    const kinds = [
      '// eslint-disable',
      '// eslint-disable-line',
      '// eslint-disable-next-line',
      '// @ts-ignore',
      '// @ts-expect-error',
      '// @ts-nocheck',
      '// phpcs:ignore',
      '# noqa',
    ];
    const map = computeRiskMap(
      buildInput([{ path: 'src/a.ts', lines: 400, added: kinds }]),
    );

    const { reasons } = map.startHere[0];
    expect(reasons).toHaveLength(MAX_REASONS_PER_FILE + 1);
    expect(reasons[MAX_REASONS_PER_FILE]).toMatch(/^외 \d+개$/);
  });

  it('같은 종류의 억제 지시문은 한 사유로 접는다 — 코멘트 본문이 커지지 않게', () => {
    const map = computeRiskMap(
      buildInput([
        {
          path: 'src/a.ts',
          lines: 2000,
          added: Array.from(
            { length: 2000 },
            () => '// eslint-disable-next-line',
          ),
        },
      ]),
    );

    expect(map.startHere[0].reasons).toContain(
      '`eslint-disable-next-line` 추가 ×2000 (1·2·3줄 외)',
    );
    expect(map.startHere[0].reasons.length).toBeLessThanOrEqual(7);
  });

  it('문자열 안의 지시문 이름은 억제로 보지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        {
          path: 'src/a.ts',
          added: [
            `const rule = 'eslint-disable';`,
            `const hint = "// eslint-disable 금지";`,
          ],
        },
      ]),
    );

    const plain = computeRiskMap(buildInput([{ path: 'src/a.ts' }]));
    expect(map.score).toBe(plain.score);
  });

  it('짝 테스트를 함께 고친 소스에는 테스트 신호가 붙지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        { path: 'src/a.ts', lines: 200 },
        { path: 'src/a.spec.ts', lines: 50 },
        { path: 'src/b.ts', lines: 200 },
      ]),
    );

    const reasonsOf = (path: string): string[] =>
      map.startHere.find((file) => file.path === path)?.reasons ?? [];
    expect(reasonsOf('src/a.ts')).not.toContain(
      '이 PR 에서 짝 테스트를 고치지 않음',
    );
    expect(reasonsOf('src/b.ts')).toContain(
      '이 PR 에서 짝 테스트를 고치지 않음',
    );
  });

  it('짝 테스트 신호는 바뀐 줄 수에 비례해, 몇 줄짜리 수정에는 붙지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        { path: 'src/small.ts', lines: 2 },
        { path: 'src/large.ts', lines: 400 },
      ]),
    );

    const reasonsOf = (path: string): string[] =>
      map.startHere.find((file) => file.path === path)?.reasons ?? [];
    expect(reasonsOf('src/small.ts')).not.toContain(
      '이 PR 에서 짝 테스트를 고치지 않음',
    );
    expect(reasonsOf('src/large.ts')).toContain(
      '이 PR 에서 짝 테스트를 고치지 않음',
    );
  });

  it('짝 테스트를 판정할 수 없는 언어는 점수에 넣지 않고 그 사실을 적는다', () => {
    const map = computeRiskMap(
      buildInput([{ path: 'app/service.py', lines: 10 }]),
    );

    expect(map.notes).toContain(
      '짝 테스트를 판정하지 못한 코드 파일 1개(JS·TS·PHP 밖)는 테스트 신호를 빼고 계산했습니다.',
    );
    expect(
      map.startHere.flatMap((file) => file.reasons).join(' '),
    ).not.toContain('짝 테스트');
  });

  it('기존 테스트를 지우거나 크게 줄이면 가볍게 확인 이상이다', () => {
    const removed = computeRiskMap(
      buildInput([{ path: 'src/a.spec.ts', status: 'removed', deletions: 80 }]),
    );
    // lines 는 추가 + 삭제다 — 아래 둘은 추가 0줄.
    const trimmed = computeRiskMap(
      buildInput([{ path: 'src/a.spec.ts', lines: 12, deletions: 12 }]),
    );
    const touched = computeRiskMap(
      buildInput([{ path: 'src/a.spec.ts', lines: 2, deletions: 2 }]),
    );

    expect(removed.levelReasons).toContain('기존 테스트 삭제·대폭 축소');
    expect(trimmed.levelReasons).toContain('기존 테스트 삭제·대폭 축소');
    expect(trimmed.startHere[0].reasons).toContain('기존 테스트 12줄 순감');
    expect(touched.level).toBe(RiskMapLevel.PASS);
  });

  it('테스트를 다시 쓰며 늘렸으면 삭제 줄이 많아도 축소가 아니다', () => {
    const map = computeRiskMap(
      buildInput([{ path: 'src/a.spec.ts', lines: 262, deletions: 16 }]),
    );

    expect(map.levelReasons).not.toContain('기존 테스트 삭제·대폭 축소');
    expect(map.level).toBe(RiskMapLevel.PASS);
  });

  it('원래 테스트를 두지 않는 선언 파일에는 짝 테스트 신호를 붙이지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        // 크기를 키워야 신호가 실린다 — 작으면 크기 비례분이 반 점에 못 미쳐 면제와 무관하게 빠진다.
        { path: 'src/a/a-error-code.enum.ts', lines: 400 },
        { path: 'src/a/a.exception.ts', lines: 400 },
        { path: 'src/a/a.type.ts', lines: 400 },
        { path: 'src/a/dto/a.dto.ts', lines: 400 },
        { path: 'src/a/a.module.ts', lines: 400 },
        { path: 'src/a/index.ts', lines: 400 },
      ]),
    );

    expect(
      map.startHere.flatMap((file) => file.reasons).join(' '),
    ).not.toContain('짝 테스트');
  });

  it('파일 목록이 잘리면 가볍게 확인 이상이고 못 본 범위를 적는다', () => {
    const map = computeRiskMap(
      buildInput([{ path: 'README.md' }], { filesTruncated: true }),
    );

    expect(map.level).toBe(RiskMapLevel.QUICK);
    expect(map.levelReasons).toContain('일부 파일 미분석');
    expect(map.notes).toContain('변경 파일 11개 중 1개만 분석했습니다.');
  });

  it('변경 종류를 받지 못하면 테스트 삭제를 보지 않았다고 적는다', () => {
    const map = computeRiskMap(
      buildInput(
        [{ path: 'src/a.spec.ts', status: 'removed', deletions: 80 }],
        {
          withStats: false,
        },
      ),
    );

    expect(map.levelReasons).not.toContain('기존 테스트 삭제·대폭 축소');
    expect(map.notes).toContain(
      '파일별 변경 종류를 받지 못해 모두 수정으로 보고, 테스트 삭제는 보지 않았습니다.',
    );
  });

  it('인프라 파일이 여럿이어도 합계 상한(12점)을 넘지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        { path: '.github/workflows/a.yml' },
        { path: '.github/workflows/b.yml' },
        { path: 'docker-compose.yml' },
      ]),
    );

    expect(map.score).toBe(12);
    expect(map.score).toBeLessThan(QUICK_SCORE);
    expect(map.level).toBe(RiskMapLevel.QUICK);
  });

  it('공유 상한은 파일이 아주 많아도 사라지지 않는다', () => {
    const infra = computeRiskMap(
      buildInput(
        Array.from({ length: 50 }, (_, index) => ({
          path: `.github/workflows/job-${index}.yml`,
        })),
      ),
    );
    const untested = computeRiskMap(
      buildInput(
        Array.from({ length: 50 }, (_, index) => ({
          path: `src/feature/file-${index}.ts`,
          lines: 400,
        })),
      ),
    );

    // 파일 몫을 선형으로 나누면 11점이 된다 — 정확히 12점이어야 한다.
    expect(infra.score).toBe(12);
    expect(untested.startHere[0].reasons).toContain(
      '이 PR 에서 짝 테스트를 고치지 않음',
    );
  });

  it('짝 테스트 없이 바뀐 파일 하나의 테스트 몫은 파일 상한(15점)에서 멈춘다', () => {
    const map = computeRiskMap(buildInput([{ path: 'src/a.ts', lines: 400 }]));

    // 수정 400줄 0.2 + 짝 테스트 0.15 → 1 − 0.8 × 0.85 = 32점. 상한이 없으면 공유 몫 0.2 로 36점.
    expect(map.startHere[0].points).toBe(32);
  });

  it('지운 테스트는 짝으로 치지 않는다', () => {
    const map = computeRiskMap(
      buildInput([
        { path: 'src/a.ts', lines: 200 },
        { path: 'src/a.spec.ts', status: 'removed', deletions: 40 },
      ]),
    );

    expect(
      map.startHere.find((file) => file.path === 'src/a.ts')?.reasons,
    ).toContain('이 PR 에서 짝 테스트를 고치지 않음');
  });

  it('여기부터 목록은 최대 7개다', () => {
    const map = computeRiskMap(
      buildInput(
        Array.from({ length: 10 }, (_, index) => ({
          path: `src/core/module-${index}.ts`,
          lines: 400,
        })),
      ),
    );

    expect(map.startHere).toHaveLength(START_HERE_MAX);
    expect(map.overflowCount).toBe(3);
    expect(map.lowCount).toBe(0);
  });

  it('짝 테스트를 못 보는 언어도 코드로 세고 판정 불가를 적는다', () => {
    const map = computeRiskMap(
      buildInput([{ path: 'src/main.rs', lines: 5000 }]),
    );

    expect(map.score).toBeGreaterThan(0);
    expect(map.notes).toContain(
      '짝 테스트를 판정하지 못한 코드 파일 1개(JS·TS·PHP 밖)는 테스트 신호를 빼고 계산했습니다.',
    );
  });

  it('git 이 따옴표로 감싼 경로·끝에 탭이 붙은 경로도 그 파일 행에 붙는다', () => {
    const token = fakeGithubToken();
    const input = buildInput([
      { path: '한.ts', lines: 1 },
      // 표에 오르도록(5점 이상) 크기를 키운다.
      { path: 'a b.ts', lines: 400 },
    ]);
    input.diff.diff = [
      '--- "a/\\355\\225\\234.ts"',
      '+++ "b/\\355\\225\\234.ts"',
      '@@ -0,0 +1 @@',
      `+const t = '${token}';`,
      '--- a/a b.ts\t',
      '+++ b/a b.ts\t',
      '@@ -0,0 +1 @@',
      '+run(); // @ts-ignore',
    ].join('\n');

    const reasonsOf = (path: string): string[] =>
      computeRiskMap(input).startHere.find((file) => file.path === path)
        ?.reasons ?? [];

    expect(reasonsOf('한.ts')).toContain(
      '1줄 GitHub 토큰 형식 문자열 — 유출 여부 확인',
    );
    expect(reasonsOf('a b.ts')).toContain('1줄 `@ts-ignore` 추가');
  });

  it.each([
    [
      '식별자 안의 sk- 는 키가 아니다',
      `import x from './disk-space-warning-threshold-percent-limit-config';`,
      false,
    ],
    [
      '공급자 문서의 예시 키는 유출이 아니다',
      `const id = 'AKIA${'IOSFODNN7EXAMPLE'}';`,
      false,
    ],
    [
      '같은 줄 예시 토큰 뒤의 진짜 토큰도 잡는다',
      `// gh${'p'}_${'x'.repeat(36)} 대신 ${fakeGithubToken()}`,
      true,
    ],
  ])('%s', (_, line, secret) => {
    const map = computeRiskMap(
      buildInput([{ path: 'src/config.ts', lines: 1, added: [line] }]),
    );

    expect(map.level === RiskMapLevel.CAREFUL).toBe(secret);
  });

  it.each([
    [24, RiskMapLevel.PASS],
    [25, RiskMapLevel.QUICK],
    [59, RiskMapLevel.QUICK],
    [60, RiskMapLevel.CAREFUL],
  ])('점수 %s 점은 %s 다 (등급 경계)', (score, level) => {
    const input: LevelInput = {
      score,
      secretFound: false,
      schemaChanged: false,
      infraChanged: false,
      filesTruncated: false,
      testsCut: false,
    };

    expect(decideLevel(input).level).toBe(level);
  });

  it('리뷰 지적은 파일 옆 건수로만 붙고 점수를 바꾸지 않는다', () => {
    const files: FileFixture[] = [{ path: 'src/a.ts', lines: 300 }];
    const findings: ReviewFinding[] = [
      {
        category: 'CORRECTNESS',
        severity: 'MUST_FIX',
        file: 'src/a.ts',
        line: 3,
        body: 'x',
      },
      {
        category: 'READABILITY',
        severity: 'NICE_TO_HAVE',
        file: 'src/a.ts',
        line: 9,
        body: 'y',
      },
    ];

    const without = computeRiskMap(buildInput(files));
    const withFindings = computeRiskMap(buildInput(files, { findings }));

    expect(withFindings.score).toBe(without.score);
    expect(withFindings.startHere[0]).toMatchObject({
      findingCount: 2,
      mustFixCount: 1,
    });
  });

  it('합계 상한을 나눠 가진 파일도 표에 오른다 — 몫이 작아져도 파일 위험은 그대로다', () => {
    const infra = computeRiskMap(
      buildInput([
        { path: '.github/workflows/a.yml' },
        { path: '.github/workflows/b.yml' },
        { path: 'docker-compose.yml' },
      ]),
    );
    const migrations = computeRiskMap(
      buildInput(
        Array.from({ length: 10 }, (_, index) => ({
          path: `prisma/migrations/${index}/migration.sql`,
        })),
      ),
    );

    expect(infra.score).toBe(12);
    expect(infra.startHere.map((file) => file.path)).toContain(
      'docker-compose.yml',
    );
    expect(migrations.score).toBe(35);
    expect(migrations.startHere).toHaveLength(START_HERE_MAX);
    expect(migrations.startHere[0].points).toBe(35);
  });

  it('머지 전 필수 지적이 있는 파일은 점수가 낮아도 표에 오른다', () => {
    const findings: ReviewFinding[] = [
      {
        category: 'CORRECTNESS',
        severity: 'MUST_FIX',
        file: 'README.md',
        line: 1,
        body: 'x',
      },
    ];

    const map = computeRiskMap(
      buildInput([{ path: 'README.md' }, { path: 'docs/a.md' }], { findings }),
    );

    expect(map.startHere.map((file) => file.path)).toEqual(['README.md']);
    expect(map.lowCount).toBe(1);
  });

  it('같은 입력이면 같은 결과다', () => {
    const input = buildInput([
      { path: 'src/b.ts', lines: 120 },
      { path: 'src/a.ts', lines: 120 },
      { path: 'package.json' },
    ]);

    expect(computeRiskMap(input)).toEqual(computeRiskMap(input));
    // 점수가 같으면 경로순이다.
    expect(computeRiskMap(input).startHere.map((file) => file.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'package.json',
    ]);
  });
});
