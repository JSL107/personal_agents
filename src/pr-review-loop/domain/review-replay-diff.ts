import {
  DiffLineKind,
  isChangedLine,
  scanDiffLines,
} from '../../agent/code-reviewer/domain/diff-added-lines';

// 프롬프트에 실리는 파일 목록·증감 줄 수를 재생 diff에서 다시 센다. 현재 PR 값을 그대로 두면
// 모델이 보는 diff와 메타데이터가 어긋난다(카드 이후 커밋이 더 붙은 PR).
export interface DiffSummary {
  changedFiles: string[];
  changedFilesTotalCount: number;
  changedFilesTruncated: boolean;
  // 운영은 `pulls.listFiles` 값을 쓴다. 재생은 카드 시점 head 의 diff 에서 센다 — 현재 PR 의 API 값은
  // 그 뒤 커밋까지 섞여 있다. --full-file-list 면 잘리지 않은 diff 라 운영과 같아진다.
  changedLinesByFile: Record<string, number>;
  additions: number;
  deletions: number;
}

// 삭제된 파일(`+++ /dev/null`)은 scanDiffLines 가 변경 전 경로로 이름 붙인다 — 목록에서 빠지지 않는다.
export const summarizeDiff = (diff: string): DiffSummary => {
  const lines = scanDiffLines(diff);
  const changedFiles = lines.flatMap(({ kind, file }) =>
    kind === DiffLineKind.FILE && file !== undefined ? [file] : [],
  );
  const changed = lines.filter(isChangedLine);
  const additions = changed.filter(
    ({ kind }) => kind === DiffLineKind.ADDED,
  ).length;
  const changedLinesByFile = Object.fromEntries(
    changedFiles.map((path) => [
      path,
      changed.filter(({ file }) => file === path).length,
    ]),
  );
  return {
    changedFiles,
    changedFilesTotalCount: changedFiles.length,
    changedFilesTruncated: false,
    changedLinesByFile,
    additions,
    deletions: changed.length - additions,
  };
};
