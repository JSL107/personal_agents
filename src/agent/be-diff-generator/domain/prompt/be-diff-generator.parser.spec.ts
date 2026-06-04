import { BeDiffGeneratorException } from '../be-diff-generator.exception';
import { parseBeDiffGeneration } from './be-diff-generator.parser';

const validDiff = `--- a/src/foo/foo.ts
+++ b/src/foo/foo.ts
@@ -1,3 +1,4 @@
 export const foo = () => {
-  return 1;
+  return 2;
+  // doubled
 };`;

const validNewFileDiff = `--- /dev/null
+++ b/src/foo/bar.ts
@@ -0,0 +1,3 @@
+export const bar = () => {
+  return 'hi';
+};`;

describe('parseBeDiffGeneration', () => {
  it('정상 JSON + valid diff + changedFiles 일치', () => {
    const json = JSON.stringify({
      diff: validDiff,
      reasoning: 'foo 반환값을 2로 변경',
      changedFiles: ['src/foo/foo.ts'],
    });
    const result = parseBeDiffGeneration(json);
    expect(result.changedFiles).toEqual(['src/foo/foo.ts']);
    expect(result.reasoning).toContain('foo');
  });

  it('새 파일 생성 — `--- /dev/null` 헤더도 허용', () => {
    const json = JSON.stringify({
      diff: validNewFileDiff,
      reasoning: 'bar 헬퍼 추가',
      changedFiles: ['src/foo/bar.ts'],
    });
    expect(parseBeDiffGeneration(json).changedFiles).toEqual([
      'src/foo/bar.ts',
    ]);
  });

  it('```json 코드 펜스 감싼 응답도 벗겨낸 뒤 파싱', () => {
    const json = JSON.stringify({
      diff: validDiff,
      reasoning: 'r',
      changedFiles: ['src/foo/foo.ts'],
    });
    expect(parseBeDiffGeneration('```json\n' + json + '\n```')).toBeDefined();
  });

  it('JSON 파싱 불가 → INVALID_MODEL_OUTPUT', () => {
    expect(() => parseBeDiffGeneration('not json')).toThrow(
      BeDiffGeneratorException,
    );
  });

  it('shape 불일치 (diff 누락) → INVALID_MODEL_OUTPUT', () => {
    const json = JSON.stringify({ reasoning: 'r', changedFiles: [] });
    expect(() => parseBeDiffGeneration(json)).toThrow(BeDiffGeneratorException);
  });

  it('diff file header 누락 → INVALID_DIFF_FORMAT', () => {
    const json = JSON.stringify({
      diff: '@@ -1,1 +1,1 @@\n-old\n+new',
      reasoning: 'r',
      changedFiles: ['x'],
    });
    expect(() => parseBeDiffGeneration(json)).toThrow(BeDiffGeneratorException);
  });

  it('diff hunk header 누락 → INVALID_DIFF_FORMAT', () => {
    const json = JSON.stringify({
      diff: '--- a/foo.ts\n+++ b/foo.ts\nno hunk',
      reasoning: 'r',
      changedFiles: ['foo.ts'],
    });
    expect(() => parseBeDiffGeneration(json)).toThrow(BeDiffGeneratorException);
  });

  it('changedFiles 가 diff 와 불일치 → INVALID_DIFF_FORMAT', () => {
    const json = JSON.stringify({
      diff: validDiff,
      reasoning: 'r',
      changedFiles: ['src/something-else.ts'],
    });
    expect(() => parseBeDiffGeneration(json)).toThrow(BeDiffGeneratorException);
  });

  it('절대경로 path 거절 (path traversal 1차 가드)', () => {
    const absDiff = `--- /dev/null
+++ b//etc/passwd
@@ -0,0 +1,1 @@
+x`;
    const json = JSON.stringify({
      diff: absDiff,
      reasoning: 'r',
      changedFiles: ['/etc/passwd'],
    });
    expect(() => parseBeDiffGeneration(json)).toThrow(BeDiffGeneratorException);
  });

  it('`../` traversal 거절', () => {
    const traversalDiff = `--- /dev/null
+++ b/../etc/passwd
@@ -0,0 +1,1 @@
+x`;
    const json = JSON.stringify({
      diff: traversalDiff,
      reasoning: 'r',
      changedFiles: ['../etc/passwd'],
    });
    expect(() => parseBeDiffGeneration(json)).toThrow(BeDiffGeneratorException);
  });
});
