import {
  assembleCompanionSpecs,
  countChangedLines,
  isCompanionTestPath,
  mapTestsToSources,
  selectCompanionSpecs,
} from './companion-spec';

const entries = (
  paths: Record<string, number>,
): { path: string; size: number }[] =>
  Object.entries(paths).map(([path, size]) => ({ path, size }));

describe('isCompanionTestPath', () => {
  it('JS/TS spec·test 와 tests/ 아래 PHP Test 를 테스트로 본다', () => {
    expect(isCompanionTestPath('src/a/b.spec.ts')).toBe(true);
    expect(isCompanionTestPath('src/a/b.test.tsx')).toBe(true);
    expect(isCompanionTestPath('app/tests/src/Controllers/AuthTest.php')).toBe(
      true,
    );
    expect(isCompanionTestPath('src/a/b.ts')).toBe(false);
    // tests/ 밖의 *Test.php 는 이름만 그럴 뿐 테스트 관례 밖이다.
    expect(isCompanionTestPath('app/src/AbTest.php')).toBe(false);
  });
});

describe('mapTestsToSources', () => {
  it('같은 폴더의 X.spec 과 X.<주제>.spec 을 X 에 붙인다', () => {
    const map = mapTestsToSources([
      'src/m/MemberModel.ts',
      'src/m/MemberModel.spec.ts',
      'src/m/MemberModel.duplicateConstraints.spec.ts',
      'src/other/MemberModel.spec.ts',
    ]);
    expect(map.get('src/m/MemberModel.ts')).toEqual([
      'src/m/MemberModel.spec.ts',
      'src/m/MemberModel.duplicateConstraints.spec.ts',
    ]);
  });

  it('이름이 겹치면 가장 긴 소스가 가져간다', () => {
    const map = mapTestsToSources([
      'src/user.ts',
      'src/user.service.ts',
      'src/user.service.spec.ts',
      'src/user.spec.ts',
    ]);
    expect(map.get('src/user.service.ts')).toEqual([
      'src/user.service.spec.ts',
    ]);
    expect(map.get('src/user.ts')).toEqual(['src/user.spec.ts']);
  });

  it('선언 파일(.d.ts)은 소스로 보지 않는다', () => {
    const map = mapTestsToSources(['src/a.d.ts', 'src/a.spec.ts']);
    expect(map.size).toBe(0);
  });

  it('PHP 는 tests/ 를 뺀 같은 폴더에서 기능 이름 접두로 짝짓는다', () => {
    const map = mapTestsToSources([
      'app/src/Controllers/Survey.php',
      'app/src/Controllers/SurveyV3.php',
      'app/src/Models/SurveyV3.php',
      'app/tests/src/Controllers/SurveyV3DrawTest.php',
      'app/tests/src/Controllers/SurveyTest.php',
    ]);
    expect(map.get('app/src/Controllers/SurveyV3.php')).toEqual([
      'app/tests/src/Controllers/SurveyV3DrawTest.php',
    ]);
    expect(map.get('app/src/Controllers/Survey.php')).toEqual([
      'app/tests/src/Controllers/SurveyTest.php',
    ]);
  });

  it('PHP 짝이 여러 폴더에 있고 미러 폴더가 아니면 버린다', () => {
    const map = mapTestsToSources([
      'app/src/Models/Comment.php',
      'app/src/Routes/Comment.php',
      'app/tests/src/Controllers/CommentTest.php',
    ]);
    expect(map.size).toBe(0);
  });
});

describe('countChangedLines', () => {
  it('파일별 추가·삭제 줄을 센다(헤더 줄 제외)', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '-old',
      '+new',
      '+more',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '+x',
    ].join('\n');
    expect([...countChangedLines(diff)]).toEqual([
      ['src/a.ts', 3],
      ['src/b.ts', 1],
    ]);
  });
});

describe('selectCompanionSpecs', () => {
  const tree = entries({
    'src/a.ts': 100,
    'src/a.spec.ts': 1000,
    'src/b.ts': 100,
    'src/b.spec.ts': 1000,
    'src/c.ts': 100,
  });

  it('바뀐 줄 수가 큰 소스의 테스트부터, diff 에 든 spec 자신도 싣는다', () => {
    const { candidates, omitted } = selectCompanionSpecs({
      changedPaths: ['src/a.ts', 'src/b.spec.ts', 'src/c.ts'],
      changedLines: new Map([
        ['src/a.ts', 2],
        ['src/b.spec.ts', 9],
      ]),
      tree,
      treeTruncated: false,
    });
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'src/b.spec.ts',
      'src/a.spec.ts',
    ]);
    expect(omitted).toEqual([]);
  });

  it('head 트리에 없는(삭제된) 테스트는 고르지 않는다', () => {
    const { candidates } = selectCompanionSpecs({
      changedPaths: ['src/gone.spec.ts'],
      changedLines: new Map(),
      tree,
      treeTruncated: false,
    });
    expect(candidates).toEqual([]);
  });

  it('바이트 예산과 개수 상한을 넘는 것은 생략으로 돌린다', () => {
    const budget = selectCompanionSpecs({
      changedPaths: ['src/a.ts', 'src/b.ts'],
      changedLines: new Map([
        ['src/a.ts', 5],
        ['src/b.ts', 1],
      ]),
      tree,
      treeTruncated: false,
      maxBytes: 1500,
    });
    expect(budget.candidates.map((candidate) => candidate.path)).toEqual([
      'src/a.spec.ts',
    ]);
    expect(budget.omitted).toEqual(['src/b.spec.ts']);

    const count = selectCompanionSpecs({
      changedPaths: ['src/a.ts', 'src/b.ts'],
      changedLines: new Map(),
      tree,
      treeTruncated: false,
      maxFiles: 1,
    });
    expect(count.omitted).toHaveLength(1);
  });

  it('트리가 잘렸으면 짝 없는 소스에 추측 경로를 크기 미상으로 둔다', () => {
    const { candidates } = selectCompanionSpecs({
      changedPaths: ['src/c.ts'],
      changedLines: new Map(),
      tree,
      treeTruncated: true,
    });
    expect(candidates).toEqual([
      { path: 'src/c.spec.ts', size: undefined, weight: 0 },
      { path: 'src/c.test.ts', size: undefined, weight: 0 },
    ]);
  });
});

describe('selectCompanionSpecs — 추측 후보', () => {
  it('트리가 잘려 추측한 경로는 상한에 걸려도 생략 목록에 넣지 않는다 — 있는지 모르는 테스트를 있다고 적지 않게', () => {
    const { candidates, omitted } = selectCompanionSpecs({
      changedPaths: ['src/a.ts', 'src/c.ts'],
      changedLines: new Map([['src/a.ts', 5]]),
      tree: entries({ 'src/a.ts': 1, 'src/a.spec.ts': 10, 'src/c.ts': 1 }),
      treeTruncated: true,
      maxFiles: 1,
    });
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      'src/a.spec.ts',
    ]);
    expect(omitted).toEqual([]);
  });
});

describe('assembleCompanionSpecs', () => {
  it('줄 번호를 붙이고, 예산을 넘는 파일은 통째로 빼고 다음 파일을 싣는다', () => {
    const assembled = assembleCompanionSpecs(
      [
        { path: 'big.spec.ts', content: 'x'.repeat(500) },
        { path: 'small.spec.ts', content: 'it(1)\nit(2)' },
      ],
      200,
    );
    expect(assembled.includedPaths).toEqual(['small.spec.ts']);
    expect(assembled.omittedPaths).toEqual(['big.spec.ts']);
    expect(assembled.text).toBe(
      '### small.spec.ts (전체 11 bytes)\n1: it(1)\n2: it(2)',
    );
    expect(assembled.bytes).toBeLessThanOrEqual(200);
  });
});
