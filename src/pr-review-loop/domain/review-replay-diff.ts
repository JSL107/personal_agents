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

// 비ASCII 경로는 git(core.quotePath 기본값)이 `+++ "b/\355\225\234.ts"` 처럼 따옴표로 감싸고 8진수로 이스케이프한다.
// 이 헤더를 못 읽으면 `current` 가 앞 파일에 머물러 이 파일의 증감이 앞 파일에 더해진다.
const GIT_PATH_ESCAPES: Record<string, string> = {
  t: '\t',
  n: '\n',
  '"': '"',
  '\\': '\\',
};

const parseHeaderPath = (
  line: string,
  marker: '--- a/' | '+++ b/',
): string | undefined => {
  if (line.startsWith(marker)) {
    return line.slice(marker.length).trim();
  }
  const quoted = `${marker.slice(0, 4)}"${marker.slice(4)}`;
  const trimmed = line.trimEnd();
  if (!trimmed.startsWith(quoted) || !trimmed.endsWith('"')) {
    return undefined;
  }
  // 8진수 이스케이프는 UTF-8 바이트 하나씩이다 — latin1 로 바이트를 모은 뒤 UTF-8 로 다시 읽는다.
  const bytes = trimmed
    .slice(quoted.length, -1)
    .replace(/\\([0-7]{3}|.)/g, (_, code: string) =>
      code.length === 3
        ? String.fromCharCode(parseInt(code, 8))
        : (GIT_PATH_ESCAPES[code] ?? code),
    );
  return Buffer.from(bytes, 'latin1').toString('utf-8');
};

export const summarizeDiff = (diff: string): DiffSummary => {
  const changedFiles: string[] = [];
  const changedLinesByFile: Record<string, number> = {};
  let current: string | undefined;
  let additions = 0;
  let deletions = 0;
  // 삭제된 파일은 `--- a/경로` 다음에 `+++ /dev/null` 이 온다 — 새 경로만 모으면 그 파일이 목록에서 빠진다.
  let removedPath: string | undefined;
  for (const line of diff.split('\n')) {
    const oldPath = parseHeaderPath(line, '--- a/');
    if (oldPath !== undefined) {
      removedPath = oldPath;
      continue;
    }
    const newPath = parseHeaderPath(line, '+++ b/');
    if (newPath !== undefined) {
      current = newPath;
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
