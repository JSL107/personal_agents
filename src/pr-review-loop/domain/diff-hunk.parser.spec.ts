import {
  extractFileDiff,
  firstCommentableLine,
  isTouchedByChanges,
  parseDiffBaseHunks,
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

describe('firstCommentableLine', () => {
  const hunks = parseDiffHunks(DIFF);

  // 모델이 line 을 비워 보내도 파일 단위로 강등하지 않고 인라인으로 붙이기 위한 폴백.
  // 파일 헤더에 달린 코멘트는 어느 줄에 대한 지적인지 보이지 않아 리뷰 가치가 크게 떨어진다.
  it('그 파일 첫 변경 hunk 의 시작 줄을 반환한다', () => {
    expect(
      firstCommentableLine({ hunks, filePath: 'src/foo.service.ts' }),
    ).toBe(10);
    expect(firstCommentableLine({ hunks, filePath: 'src/bar.util.ts' })).toBe(
      1,
    );
  });

  it('diff 에 없는 파일이면 null — 변경되지 않은 파일엔 인라인을 달 수 없다', () => {
    expect(
      firstCommentableLine({ hunks, filePath: 'src/unknown.ts' }),
    ).toBeNull();
  });

  it('범위가 비어 있으면 null 을 반환한다', () => {
    expect(
      firstCommentableLine({
        hunks: [{ filePath: 'src/empty.ts', ranges: [] }],
        filePath: 'src/empty.ts',
      }),
    ).toBeNull();
  });
});

describe('parseDiffBaseHunks', () => {
  it('이전(base) 파일 기준으로 범위를 뽑는다 — 카드 line 과 좌표계를 맞추기 위해', () => {
    // 같은 diff 라도 신규 기준은 +42, base 기준은 -40 이다. 카드 line 은 카드가
    // 게시된 시점(=base) 기준이므로 이쪽으로 봐야 한다.
    const base = parseDiffBaseHunks(DIFF);
    const found = base.find((file) => file.filePath === 'src/foo.service.ts');

    expect(found?.ranges).toEqual([
      { start: 10, end: 12 },
      { start: 40, end: 41 },
    ]);
  });

  it('삭제된 파일도 잡는다 — 파일째 지우는 것도 정상적인 해소 방식이다', () => {
    const deletion = `diff --git a/src/gone.ts b/src/gone.ts
--- a/src/gone.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-const gone = 1;
`;

    expect(parseDiffBaseHunks(deletion)).toEqual([
      { filePath: 'src/gone.ts', ranges: [{ start: 1, end: 5 }] },
    ]);
    // 신규 기준 파서는 +++ /dev/null 이라 통째로 버린다 — 그래서 base 파서가 필요하다.
    expect(parseDiffHunks(deletion)).toEqual([]);
  });

  it('신규 파일은 제외한다 — 카드가 가리킬 이전 줄이 없다', () => {
    const creation = `diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+const fresh = 1;
`;

    expect(parseDiffBaseHunks(creation)).toEqual([]);
  });

  it('순수 삽입(count 0)은 그 지점을 바뀐 것으로 본다', () => {
    const insertion = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,0 +11,3 @@
+const added = 1;
`;

    expect(parseDiffBaseHunks(insertion)).toEqual([
      { filePath: 'src/foo.ts', ranges: [{ start: 10, end: 10 }] },
    ]);
  });
});

describe('isTouchedByChanges', () => {
  const hunks = parseDiffHunks(DIFF);

  it('지적한 줄이 변경 범위 안이면 true', () => {
    expect(
      isTouchedByChanges({
        hunks,
        filePath: 'src/foo.service.ts',
        line: 11,
        maxDistance: SNAP_MAX_DISTANCE,
      }),
    ).toBe(true);
  });

  it('변경이 지적한 줄에서 멀면 false — LLM 에게 묻지 않는다', () => {
    expect(
      isTouchedByChanges({
        hunks,
        filePath: 'src/foo.service.ts',
        line: 500,
        maxDistance: SNAP_MAX_DISTANCE,
      }),
    ).toBe(false);
  });

  it('그 파일이 아예 안 바뀌었으면 false', () => {
    expect(
      isTouchedByChanges({
        hunks,
        filePath: 'src/untouched.ts',
        line: 10,
        maxDistance: SNAP_MAX_DISTANCE,
      }),
    ).toBe(false);
  });
});

describe('extractFileDiff', () => {
  it('해당 파일 섹션만 잘라낸다 — 다른 파일 변경은 섞이지 않는다', () => {
    const section = extractFileDiff(DIFF, 'src/bar.util.ts');

    expect(section).toContain('src/bar.util.ts');
    expect(section).toContain('+export const bar = 1;');
    expect(section).not.toContain('src/foo.service.ts');
  });

  it('diff 에 없는 파일이면 null', () => {
    expect(extractFileDiff(DIFF, 'src/unknown.ts')).toBeNull();
  });
});
