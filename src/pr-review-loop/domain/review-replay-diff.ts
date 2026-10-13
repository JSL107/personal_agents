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

export const summarizeDiff = (diff: string): DiffSummary => {
  const changedFiles: string[] = [];
  const changedLinesByFile: Record<string, number> = {};
  let current: string | undefined;
  let additions = 0;
  let deletions = 0;
  // 삭제된 파일은 `--- a/경로` 다음에 `+++ /dev/null` 이 온다 — 새 경로만 모으면 그 파일이 목록에서 빠진다.
  let removedPath: string | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('--- a/')) {
      removedPath = line.slice('--- a/'.length).trim();
      continue;
    }
    if (line.startsWith('+++ b/')) {
      current = line.slice('+++ b/'.length).trim();
      changedFiles.push(current);
      changedLinesByFile[current] = 0;
      removedPath = undefined;
      continue;
    }
    if (line.startsWith('+++ /dev/null')) {
      if (removedPath !== undefined) {
        current = removedPath;
        changedFiles.push(current);
        changedLinesByFile[current] = 0;
        removedPath = undefined;
      }
      continue;
    }
    if (line.startsWith('+++') || line.startsWith('---')) {
      removedPath = undefined;
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    } else {
      continue;
    }
    if (current !== undefined) {
      changedLinesByFile[current] += 1;
    }
  }
  return {
    changedFiles,
    changedFilesTotalCount: changedFiles.length,
    changedFilesTruncated: false,
    changedLinesByFile,
    additions,
    deletions,
  };
};
