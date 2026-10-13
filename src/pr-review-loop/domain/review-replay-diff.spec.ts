import { summarizeDiff } from './review-replay-diff';

describe('summarizeDiff', () => {
  it('추가·수정·삭제 파일을 모두 세고 증감 줄 수를 센다', () => {
    const diff = [
      'diff --git a/src/kept.ts b/src/kept.ts',
      '--- a/src/kept.ts',
      '+++ b/src/kept.ts',
      '@@ -1,2 +1,2 @@',
      '-const before = 1;',
      '+const after = 1;',
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-const gone = 1;',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,1 @@',
      '+const fresh = 1;',
    ].join('\n');

    expect(summarizeDiff(diff)).toEqual({
      // 삭제 파일(`+++ /dev/null`)도 목록에 들어간다 — 이전 경로로 센다.
      changedFiles: ['src/kept.ts', 'src/gone.ts', 'src/new.ts'],
      changedFilesTotalCount: 3,
      changedFilesTruncated: false,
      // 파일별 증감 — 운영의 `pulls.listFiles` 값 자리를 채운다.
      changedLinesByFile: {
        'src/kept.ts': 2,
        'src/gone.ts': 1,
        'src/new.ts': 1,
      },
      additions: 2,
      deletions: 2,
    });
  });

  it('따옴표·8진수로 이스케이프된 비ASCII 경로를 풀어 그 파일의 증감으로 센다', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,1 +1,1 @@',
      '-const a = 1;',
      '+const a = 2;',
      'diff --git "a/docs/\\355\\225\\234.md" "b/docs/\\355\\225\\234.md"',
      '--- "a/docs/\\355\\225\\234.md"',
      '+++ "b/docs/\\355\\225\\234.md"',
      '@@ -0,0 +1,3 @@',
      '+하나',
      '+둘',
      '+셋',
      'diff --git "a/\\352\\270\\200.ts" "b/\\352\\270\\200.ts"',
      'deleted file mode 100644',
      '--- "a/\\352\\270\\200.ts"',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-const gone = 1;',
    ].join('\n');

    const summary = summarizeDiff(diff);

    expect(summary.changedFiles).toEqual(['src/a.ts', 'docs/한.md', '글.ts']);
    // 헤더를 못 읽으면 '한.md' 의 3줄이 앞 파일 src/a.ts 에 더해졌다.
    expect(summary.changedLinesByFile).toEqual({
      'src/a.ts': 2,
      'docs/한.md': 3,
      '글.ts': 1,
    });
  });
});
