import {
  parseDiffHunks,
  SNAP_MAX_DISTANCE,
  snapToCommentableLine,
} from './diff-hunk.parser';

const DIFF = `diff --git a/src/foo.service.ts b/src/foo.service.ts
index 1111111..2222222 100644
--- a/src/foo.service.ts
+++ b/src/foo.service.ts
@@ -10,3 +10,5 @@ export class FooService {
   const a = 1;
+  const b = 2;
+  const c = 3;
   return a;
@@ -40,2 +42,2 @@ export class FooService {
-  old();
+  next();
diff --git a/src/bar.util.ts b/src/bar.util.ts
--- a/src/bar.util.ts
+++ b/src/bar.util.ts
@@ -1 +1,2 @@
+export const bar = 1;
`;

describe('parseDiffHunks', () => {
  it('파일별로 신규 줄 범위를 뽑는다', () => {
    const hunks = parseDiffHunks(DIFF);

    expect(hunks).toEqual([
      {
        filePath: 'src/foo.service.ts',
        ranges: [
          { start: 10, end: 14 },
          { start: 42, end: 43 },
        ],
      },
      { filePath: 'src/bar.util.ts', ranges: [{ start: 1, end: 2 }] },
    ]);
  });

  it('count 가 생략된 hunk 헤더는 1줄로 본다', () => {
    const diff = `--- a/x.ts
+++ b/x.ts
@@ -5 +7 @@
+one
`;

    expect(parseDiffHunks(diff)).toEqual([
      { filePath: 'x.ts', ranges: [{ start: 7, end: 7 }] },
    ]);
  });

  it('삭제된 파일(+++ /dev/null)은 건너뛴다', () => {
    const diff = `--- a/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-gone
`;

    expect(parseDiffHunks(diff)).toEqual([]);
  });

  it('빈 diff 는 빈 배열', () => {
    expect(parseDiffHunks('')).toEqual([]);
  });
});

describe('snapToCommentableLine', () => {
  const hunks = parseDiffHunks(DIFF);

  it('범위 안의 줄은 그대로 반환한다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/foo.service.ts',
      line: 12,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBe(12);
  });

  it('범위 밖이면 가장 가까운 경계로 당긴다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/foo.service.ts',
      line: 16,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBe(14);
  });

  it('허용 거리를 넘으면 null 을 반환한다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/foo.service.ts',
      line: 500,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBeNull();
  });

  it('diff 에 없는 파일이면 null 을 반환한다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/unknown.ts',
      line: 3,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBeNull();
  });
});
