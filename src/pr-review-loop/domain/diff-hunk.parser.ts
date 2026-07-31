export interface LineRange {
  start: number;
  end: number;
}

export interface FileHunkRanges {
  filePath: string;
  ranges: LineRange[];
}

export interface SnapInput {
  hunks: FileHunkRanges[];
  filePath: string;
  line: number;
  maxDistance: number;
}

// 스냅 허용 거리. 이보다 멀면 다른 코드에 엉뚱하게 붙는 편보다 파일 단위 강등이 낫다.
export const SNAP_MAX_DISTANCE = 20;

const NEW_FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// unified diff 에서 파일별 "신규(오른쪽) 파일 기준 줄 범위"를 뽑는다.
// GitHub 인라인 코멘트는 이 범위 안의 줄에만 달 수 있다.
export const parseDiffHunks = (diff: string): FileHunkRanges[] => {
  const files: FileHunkRanges[] = [];
  let current: FileHunkRanges | null = null;

  for (const rawLine of diff.split('\n')) {
    const fileMatch = rawLine.match(NEW_FILE_HEADER);
    if (fileMatch) {
      const filePath = fileMatch[1].trim();
      if (filePath === '/dev/null') {
        current = null;
        continue;
      }
      current = { filePath, ranges: [] };
      files.push(current);
      continue;
    }

    const hunkMatch = rawLine.match(HUNK_HEADER);
    if (hunkMatch && current) {
      const start = Number(hunkMatch[1]);
      const count = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      if (count > 0) {
        current.ranges.push({ start, end: start + count - 1 });
      }
      continue;
    }
  }

  return files.filter((file) => file.ranges.length > 0);
};

// 범위 안이면 그대로, 밖이면 가장 가까운 경계로 당긴다. 너무 멀면 null.
export const snapToCommentableLine = ({
  hunks,
  filePath,
  line,
  maxDistance,
}: SnapInput): number | null => {
  const found = hunks.find((file) => file.filePath === filePath);
  if (!found) {
    return null;
  }
  const inside = found.ranges.some(
    (range) => line >= range.start && line <= range.end,
  );
  if (inside) {
    return line;
  }

  const candidates = found.ranges.flatMap((range) => [range.start, range.end]);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - line);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === null || bestDistance > maxDistance) {
    return null;
  }
  return best;
};
