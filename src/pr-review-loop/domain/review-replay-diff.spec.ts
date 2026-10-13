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
});
