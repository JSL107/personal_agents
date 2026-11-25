// eslint-disable-next-line @typescript-eslint/no-require-imports
const style = require('../../scripts/check-style-diff.cjs');

interface LintInput {
  source: string;
  file?: string;
}

const lintRules = async ({
  source,
  file = 'src/a.ts',
}: LintInput): Promise<string[]> => {
  const violations = await style.lintSource({
    linter: style.createLinter(process.cwd()),
    root: process.cwd(),
    file,
    source,
    lines: null,
  });
  return violations.map(
    (violation: { rule: { id: string } }) => violation.rule.id,
  );
};

describe('check-style-diff', () => {
  it('git diff -U0 에서 추가된 줄 번호만 모은다', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -3,0 +4,2 @@',
      '+x',
      '+y',
      '@@ -9 +11 @@',
      '+z',
      '@@ -20,2 +22,0 @@',
    ].join('\n');

    const added = style.parseAddedLines(diff);

    expect([...added.get('src/a.ts')]).toEqual([4, 5, 11]);
  });

  it('본문의 추가 줄 `++ x` 는 `+++ x` 로 찍혀도 파일 헤더로 읽지 않는다', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,0 +2 @@',
      '+++ value;',
      '@@ -5,0 +7 @@',
      '+let x = 1;',
    ].join('\n');

    const added = style.parseAddedLines(diff);

    expect([...added.get('src/a.ts')]).toEqual([2, 7]);
  });

  it.each([
    ['positional-args', 'const f = (a: number, b: number): number => a + b;'],
    ['literal-union', "type Status = 'OPEN' | 'CLOSED';"],
    ['as-const-object', "const OPTIONS = { type: 'exponential' } as const;"],
    [
      'intersection-type',
      'interface A { a: number } type B = A & { b: number };',
    ],
    ['nested-record', 'const m: Record<string, Record<string, number>> = {};'],
    ['function-type-alias', 'type Respond = (text: string) => void;'],
    ['inline-return-type', 'const f = (): { a: number } => ({ a: 1 });'],
    [
      'return-object-ternary',
      'const f = ({ ok }: { ok: boolean }) => { return { s: ok ? 1 : 2 }; };',
    ],
    ['let', 'let count = 0;'],
    ['return-ternary-call', 'const f = () => { return ok ? load() : null; };'],
    [
      'return-ternary-call',
      'const f = () => { return ok ? `${a}-${b}` : null; };',
    ],
    [
      'return-ternary-call',
      'const f = () => { return ok ? null : list.map(String); };',
    ],
  ])('%s 를 오류로 잡는다', async (rule, source) => {
    const ids = await lintRules({ source });

    expect(ids).toContain(rule);
  });

  it.each([
    [
      'return-transform',
      "const f = (lines: string[]) => { return lines.join('\\n'); };",
    ],
    [
      'return-transform',
      'const f = (turns: Turn[]) => { return turns.some((turn) => turn.ok); };',
    ],
    [
      'return-transform',
      'const f = (s: State) => { return { content: s.content.replace(a, b) }; };',
    ],
    ['return-expression', 'const f = ({ a, b }: Pair) => { return a / b; };'],
    [
      'return-expression',
      'const f = (failed: string[]) => { return { pass: failed.length === 0 }; };',
    ],
    [
      'return-expression',
      'const f = () => { return run({ band: ok ? null : 1 }); };',
    ],
    ['type-assertion', 'const counts = {} as Record<Kind, number>;'],
  ])('%s 를 경고로 잡는다', async (rule, source) => {
    const ids = await lintRules({ source });

    expect(ids).toContain(rule);
  });

  it('협력자 위임·이름 붙인 함수 넘기기·as const 는 잡지 않고, as unknown as 는 한 번만 센다', async () => {
    const source = [
      'const a = () => { return repository.find({ id: 1 }); };',
      'const b = (rows: Row[]) => { return rows.map(toRecord); };',
      "const KINDS = ['a', 'b'] as const;",
      'const c = value as unknown as Port;',
    ].join('\n');

    const ids = await lintRules({ source });

    expect(ids).toEqual(['type-assertion']);
  });

  it('return 삼항은 조건식에만 호출이 있고 갈래가 값 참조뿐이면 잡지 않는다 (CODE_RULES §1-1)', async () => {
    const source =
      'const f = () => { return isBlogCategoryId(normalized) ? normalized : undefined; };';

    expect(await lintRules({ source })).toEqual([]);
  });

  it('콜백·생성자·프레임워크 메서드의 위치 인자와 instanceof 삼항은 잡지 않는다', async () => {
    const source = [
      'const sorted = [2, 1].sort((a, b) => a - b);',
      'class C { constructor(a: number, b: number) {} catch(exception: Error, host: unknown) {} }',
      'const message = (error: unknown) => (error instanceof Error ? error.message : String(error));',
    ].join('\n');

    const ids = await lintRules({ source });

    expect(ids).toEqual([]);
  });

  it('*.type.ts 의 객체 타입 선언은 경고하지 않는다', async () => {
    const source = 'export type Options = { repository: string };';

    expect(await lintRules({ source, file: 'src/a.ts' })).toContain(
      'type-alias-object',
    );
    expect(await lintRules({ source, file: 'src/a.type.ts' })).toEqual([]);
  });

  it('eslint-disable 주석으로 의도한 예외를 남길 수 있다', async () => {
    const source = [
      '// eslint-disable-next-line no-restricted-syntax -- 테스트',
      'let count = 0;',
    ].join('\n');

    expect(await lintRules({ source })).toEqual([]);
  });
});
