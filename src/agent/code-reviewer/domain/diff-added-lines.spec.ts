import { listAddedLines, parseHeaderPath } from './diff-added-lines';

describe('listAddedLines', () => {
  it('추가 줄을 변경 후 파일 기준 줄 번호와 함께 꺼낸다', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,3 +10,4 @@',
      ' keep',
      '-gone',
      '+first',
      '+second',
      ' tail',
    ].join('\n');

    expect(listAddedLines(diff)).toEqual([
      { file: 'src/a.ts', line: 11, text: 'first' },
      { file: 'src/a.ts', line: 12, text: 'second' },
    ]);
  });

  it('hunk 본문 안의 `+++ ` 는 헤더가 아니라 추가 줄이다', () => {
    const diff = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,0 +1,2 @@',
      '+++ x',
      '+y',
    ].join('\n');

    expect(listAddedLines(diff).map((added) => added.text)).toEqual([
      '++ x',
      'y',
    ]);
  });

  it('줄 수를 생략한 hunk 와 "\\ No newline" 을 처리한다', () => {
    const diff = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -3 +3 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
    ].join('\n');

    expect(listAddedLines(diff)).toEqual([
      { file: 'a.ts', line: 3, text: 'new' },
    ]);
  });

  it('따옴표로 감싼 비ASCII 경로와 끝에 탭이 붙은 공백 경로를 푼다', () => {
    const diff = [
      '--- "a/\\355\\225\\234.ts"',
      '+++ "b/\\355\\225\\234.ts"',
      '@@ -0,0 +1 @@',
      '+x',
      '--- a/a b.ts\t',
      '+++ b/a b.ts\t',
      '@@ -0,0 +1 @@',
      '+y',
    ].join('\n');

    expect(listAddedLines(diff).map((added) => added.file)).toEqual([
      '한.ts',
      'a b.ts',
    ]);
  });

  it('지운 파일(`+++ /dev/null`)에서는 추가 줄이 나오지 않는다', () => {
    const diff = [
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
    ].join('\n');

    expect(listAddedLines(diff)).toEqual([]);
  });
});

describe('parseHeaderPath', () => {
  it.each([
    ['+++ b/src/a.ts', 'src/a.ts'],
    ['+++ b/a b.ts\t', 'a b.ts'],
    ['+++ b/a.ts\r', 'a.ts'],
    ['+++ "b/\\355\\225\\234.ts"', '한.ts'],
    ['+++ "b/say \\"hi\\".ts"', 'say "hi".ts'],
    ['+++ /dev/null', undefined],
  ])('%j → %j', (line, path) => {
    expect(parseHeaderPath(line, '+++ b/')).toBe(path);
  });
});
