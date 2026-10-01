import {
  assembleRelatedCode,
  excerptChangedFile,
  excerptUsages,
  extractChangedSymbols,
  FULL_FILE_MAX_LINES,
  parseChangedFileRanges,
} from './related-code';

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');

describe('parseChangedFileRanges', () => {
  it('head 기준 범위를 뽑고, 순수 삭제 hunk 는 지점으로 남기며 삭제 파일·lockfile 은 뺀다', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,3 +10,4 @@ ctx',
      '@@ -40,2 +41,0 @@ ctx',
      'diff --git a/src/gone.ts b/src/gone.ts',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml',
      '--- a/pnpm-lock.yaml',
      '+++ b/pnpm-lock.yaml',
      '@@ -1,1 +1,1 @@',
    ].join('\n');

    expect(parseChangedFileRanges(diff)).toEqual([
      {
        filePath: 'src/a.ts',
        ranges: [
          { start: 10, end: 13 },
          { start: 41, end: 41 },
        ],
      },
    ]);
  });
});

describe('extractChangedSymbols', () => {
  // PR #707 형태 — 바뀐 export 상수가 사용처 검색 대상이 돼야 한다.
  it('export 선언 → 최상위 선언 → 합성 객체 키 순으로, 테스트 파일과 흔한 키는 빼고 뽑는다', () => {
    const diff = [
      'diff --git a/src/rule.ts b/src/rule.ts',
      '+++ b/src/rule.ts',
      '-export const SCREENER_RULE_VERSION = 6;',
      '+export const SCREENER_RULE_VERSION = 7;',
      '+const helperTable = {};',
      '+  const localValue = 1;',
      '+  investorFlow20: 0.3,',
      '+  select: (candidate) => candidate,',
      ' export const untouched = 1;',
      'diff --git a/src/rule.spec.ts b/src/rule.spec.ts',
      '+++ b/src/rule.spec.ts',
      '+export const fromSpec = 1;',
    ].join('\n');

    expect(extractChangedSymbols(diff)).toEqual([
      'SCREENER_RULE_VERSION',
      'helperTable',
      'investorFlow20',
    ]);
  });

  it('상한 개수까지만 낸다', () => {
    const diff = Array.from(
      { length: 8 },
      (_, index) => `+export function name${index}() {}`,
    ).join('\n');
    expect(extractChangedSymbols(diff, 5)).toHaveLength(5);
  });
});

describe('excerptChangedFile', () => {
  it(`${FULL_FILE_MAX_LINES}줄 이하면 줄 번호를 붙인 전문을 낸다`, () => {
    const result = excerptChangedFile(lines(FULL_FILE_MAX_LINES), [
      { start: 5, end: 5 },
    ]);
    expect(result.split('\n')).toHaveLength(FULL_FILE_MAX_LINES);
    expect(result.startsWith('1: line 1')).toBe(true);
  });

  it('넘으면 바뀐 구간 앞뒤 20줄 창만, 겹치는 창은 합쳐 낸다', () => {
    const result = excerptChangedFile(lines(1000), [
      { start: 100, end: 101 },
      { start: 130, end: 130 },
      { start: 900, end: 900 },
    ]);
    const windows = result.split('\n...\n');
    expect(windows).toHaveLength(2);
    expect(windows[0].startsWith('80: line 80')).toBe(true);
    expect(windows[0].endsWith('150: line 150')).toBe(true);
    expect(windows[1].startsWith('880: line 880')).toBe(true);
    expect(windows[1].endsWith('920: line 920')).toBe(true);
  });
});

describe('excerptUsages', () => {
  it('이름이 단어로 나오는 줄 앞뒤 3줄을 내고, 부분 일치는 무시한다', () => {
    const content = [
      ...lines(10).split('\n'),
      'use(SCREENER_RULE_VERSION);',
      ...lines(10).split('\n'),
      'SCREENER_RULE_VERSION_OLD',
    ].join('\n');
    const result = excerptUsages(content, 'SCREENER_RULE_VERSION', 3);
    expect(result).toBe(
      [
        '8: line 8',
        '9: line 9',
        '10: line 10',
        '11: use(SCREENER_RULE_VERSION);',
        '12: line 1',
        '13: line 2',
        '14: line 3',
      ].join('\n'),
    );
  });

  it('사용처가 없으면 null', () => {
    expect(excerptUsages('nothing here', 'missing', 3)).toBeNull();
  });
});

describe('assembleRelatedCode', () => {
  it('상한 안이면 전부 싣는다', () => {
    const result = assembleRelatedCode(
      [
        { title: 'a', body: 'x' },
        { title: 'b', body: 'y' },
      ],
      1000,
    );
    expect(result).toEqual({
      text: '### a\nx\n\n### b\ny',
      omittedCount: 0,
      truncated: false,
    });
  });

  it('넘치는 구간은 줄 단위로 잘라 채우고 뒤 구간은 빼며, 그 사실을 표시한다', () => {
    const result = assembleRelatedCode(
      [
        { title: 'first', body: 'aaaa' },
        {
          title: 'second',
          body: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].join('\n'),
        },
        { title: 'third', body: 'zzz' },
      ],
      45,
    );
    expect(result.truncated).toBe(true);
    expect(result.omittedCount).toBe(1);
    expect(result.text).toContain('### first\naaaa');
    expect(result.text).toContain('### second\n1\n2\n... (잘림)');
    expect(result.text).not.toContain('\n3');
    expect(result.text).toContain('... (잘림)');
    expect(result.text).not.toContain('third');
    expect(Buffer.byteLength(result.text, 'utf-8')).toBeLessThanOrEqual(45);
  });
});
