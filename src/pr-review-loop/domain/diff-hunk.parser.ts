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

export interface FirstCommentableLineInput {
  hunks: FileHunkRanges[];
  filePath: string;
}

// 스냅 허용 거리. 이보다 멀면 다른 코드에 엉뚱하게 붙는 편보다 파일 단위 강등이 낫다.
export const SNAP_MAX_DISTANCE = 20;

const NEW_FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const OLD_FILE_HEADER = /^--- (?:a\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const BASE_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+/;

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

// 같은 diff 를 "이전(base) 파일 기준" 으로 읽는다. 해소 판정의 카드 line 은 카드가
// 게시된 시점 = 비교의 base 기준이므로, 신규 기준 범위(parseDiffHunks)와 대조하면
// 그 사이 앞쪽 삽입·삭제만큼 좌표가 밀려 엉뚱한 줄을 겹쳤다고 보거나 놓친다.
// 파일 경로도 `--- a/...` 에서 읽어 삭제된 파일(`+++ /dev/null`)까지 잡는다 —
// 문제 코드를 파일째 지우는 것도 정상적인 해소 방식이다.
export const parseDiffBaseHunks = (diff: string): FileHunkRanges[] => {
  const files: FileHunkRanges[] = [];
  let current: FileHunkRanges | null = null;

  for (const rawLine of diff.split('\n')) {
    const fileMatch = rawLine.match(OLD_FILE_HEADER);
    if (fileMatch) {
      const filePath = fileMatch[1].trim();
      if (filePath === '/dev/null') {
        current = null; // 신규 파일 — 카드가 가리킬 이전 줄이 없다.
        continue;
      }
      current = { filePath, ranges: [] };
      files.push(current);
      continue;
    }

    const hunkMatch = rawLine.match(BASE_HUNK_HEADER);
    if (hunkMatch && current) {
      const start = Number(hunkMatch[1]);
      const count = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      // count 0 은 순수 삽입(`@@ -10,0 +11,3 @@`) — 그 지점 근처가 바뀐 것으로 본다.
      current.ranges.push({
        start,
        end: count > 0 ? start + count - 1 : start,
      });
      continue;
    }
  }

  return files.filter((file) => file.ranges.length > 0);
};

// 지적한 줄 근처가 실제로 바뀌었나. 해소 판정(FIXED)의 1차 결정론 필터로, 안 겹치면
// LLM 에게 묻지 않는다. 스냅과 판정 규칙이 같아(같은 파일 · maxDistance 안) 재사용한다.
// hunks 는 반드시 parseDiffBaseHunks 로 뽑은 base 기준이어야 좌표가 맞는다.
export const isTouchedByChanges = (input: SnapInput): boolean =>
  snapToCommentableLine(input) !== null;

// unified diff 에서 한 파일의 섹션만 잘라낸다. 판정 프롬프트에 전체 diff 를 넣으면
// 무관한 변경이 섞여 판단이 흐려지므로 지적한 파일만 보여준다.
export const extractFileDiff = (
  diff: string,
  filePath: string,
): string | null => {
  const sections = diff.split(/^diff --git /m);
  for (const section of sections) {
    if (section.trim().length === 0) {
      continue;
    }
    const restored = `diff --git ${section}`;
    // base 기준으로 찾는다 — 삭제된 파일은 신규 기준으로는 잡히지 않는다.
    const hunks = parseDiffBaseHunks(restored);
    if (hunks.some((file) => file.filePath === filePath)) {
      return restored.trimEnd();
    }
  }
  return null;
};

// 모델이 line 을 비워 보낸 경우의 폴백 — 그 파일 첫 변경 줄. 파일 단위(subject_type=file)
// 코멘트는 파일 헤더에 붙어 어느 줄에 대한 지적인지 보이지 않으므로, 인라인을 우선한다.
// diff 에 없는 파일이면 애초에 인라인이 불가하므로 null (호출부가 파일 단위로 강등).
export const firstCommentableLine = ({
  hunks,
  filePath,
}: FirstCommentableLineInput): number | null => {
  const found = hunks.find((file) => file.filePath === filePath);
  return found?.ranges[0]?.start ?? null;
};
