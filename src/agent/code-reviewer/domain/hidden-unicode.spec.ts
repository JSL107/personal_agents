import {
  findHiddenUnicode,
  formatHiddenUnicodeList,
  formatHiddenUnicodeWarning,
} from './hidden-unicode';

// 문자를 소스에 직접 쓰지 않는다 — 에디터·도구를 거치며 이스케이프가 실제 문자로 바뀌면
// 이 저장소 소스에 보이지 않는 문자가 들어간다. 코드 포인트로 만들어 쓴다.
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff);
const TAG_A = String.fromCodePoint(0xe0041);
const ZWJ = String.fromCodePoint(0x200d);
const VS16 = String.fromCodePoint(0xfe0f);

const diffOf = (...lines: string[]): string =>
  [
    'diff --git a/src/auth.ts b/src/auth.ts',
    '--- a/src/auth.ts',
    '+++ b/src/auth.ts',
    '@@ -10,3 +10,4 @@',
    ...lines,
  ].join('\n');

describe('findHiddenUnicode', () => {
  it('숨은 문자가 없으면 빈 배열', () => {
    expect(findHiddenUnicode(diffOf(' const a = 1;', '+const b = 2;'))).toEqual(
      [],
    );
  });

  // Trojan Source 의 대표 형태 — 주석 안에 방향 뒤집기를 넣어 보이는 코드와 실행 코드를 가른다.
  it('추가된 줄의 방향 제어 문자를 변경 후 줄 번호와 함께 찾는다', () => {
    const findings = findHiddenUnicode(
      diffOf(
        ' const a = 1;',
        '-const old = 0;',
        `+if (isAdmin) { /* ${RLO} } ${LRI} */ grant(); }`,
      ),
    );

    expect(findings).toEqual([
      { file: 'src/auth.ts', line: 11, codePoint: 'U+202E', kind: '방향 제어' },
      { file: 'src/auth.ts', line: 11, codePoint: 'U+2066', kind: '방향 제어' },
    ]);
  });

  it('폭 없는 문자 · BOM · 태그 문자를 구분한다', () => {
    const findings = findHiddenUnicode(
      diffOf(`+a${ZWSP}b`, `+${BOM}c`, `+d${TAG_A}`),
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      '폭 없는 문자',
      'BOM',
      '태그 문자',
    ]);
    expect(findings.map((finding) => finding.line)).toEqual([10, 11, 12]);
  });

  // 삭제된 줄의 문자는 병합 후 코드에 남지 않고, 문맥 줄은 이 PR 이 만든 것이 아니다.
  it('삭제 줄과 문맥 줄은 보지 않는다', () => {
    expect(
      findHiddenUnicode(diffOf(`-old${RLO}`, ` ctx${RLO}`, '+clean')),
    ).toEqual([]);
  });

  // 가족 이모지(ZWJ)와 하트 이모지(이형 선택자)는 정상 문자열이라 경고하지 않는다.
  it('이모지에 쓰이는 ZWJ 와 이형 선택자는 무시한다', () => {
    const family = `👨${ZWJ}👩${ZWJ}👧`;
    const heart = `❤${VS16}`;

    expect(
      findHiddenUnicode(diffOf(`+const label = '${family} ${heart}';`)),
    ).toEqual([]);
  });

  it('파일이 바뀌면 파일 경로와 줄 번호를 새로 잡는다', () => {
    const diff = [
      '+++ b/a.ts',
      '@@ -1 +1 @@',
      '+x',
      '+++ b/b.ts',
      '@@ -5,0 +7,1 @@',
      `+y${ZWSP}`,
    ].join('\n');

    expect(findHiddenUnicode(diff)).toEqual([
      { file: 'b.ts', line: 7, codePoint: 'U+200B', kind: '폭 없는 문자' },
    ]);
  });
});

describe('formatHiddenUnicodeList', () => {
  it('10건까지 나열하고 나머지는 건수로 줄인다', () => {
    const findings = Array.from({ length: 12 }, (_, index) => ({
      file: 'a.ts',
      line: index + 1,
      codePoint: 'U+200B',
      kind: '폭 없는 문자' as const,
    }));
    const list = formatHiddenUnicodeList(findings);

    expect(list.split('\n')).toHaveLength(11);
    expect(list).toContain('- a.ts:10 U+200B (폭 없는 문자)');
    expect(list).toContain('- 외 2건');
  });
});

describe('formatHiddenUnicodeWarning', () => {
  it('건수를 담는다', () => {
    expect(formatHiddenUnicodeWarning(3)).toContain('안 보이는 문자 3개');
  });
});
