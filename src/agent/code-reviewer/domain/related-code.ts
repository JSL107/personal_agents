/**
 * 리뷰 입력에 diff 밖 맥락(`[related code]`)을 붙이기 위한 순수 함수들.
 *
 * 왜 필요한가: GitHub diff API 는 hunk 앞뒤 3줄만 주고 `-U` 를 바꿀 수 없다. 리뷰 모델은
 * 레포를 못 보는 격리 환경(빈 cwd + read-only)이라, 바뀐 값을 덮어쓰거나 비교하는 코드가
 * hunk 밖에 있으면 존재 자체를 모른다 — 실례: PR #707 은 SWING 1순위 재료를 바꿨는데
 * 같은 파일 206행의 `flowSlot` 교체 경로가 diff 밖이라 그 실험 플래그가 무의미해진 것을 놓쳤다.
 */

export const FULL_FILE_MAX_LINES = 400;
export const HUNK_WINDOW_LINES = 20;
export const USAGE_WINDOW_LINES = 3;
export const MAX_CHANGED_SYMBOLS = 5;
export const RELATED_CODE_MAX_BYTES = 40 * 1024;

export interface ChangedFileRanges {
  filePath: string;
  // 신규(head) 파일 기준 바뀐 줄 범위. 순수 삭제 hunk 는 삭제 지점 한 줄로 둔다.
  ranges: { start: number; end: number }[];
}

export interface RelatedCodeSection {
  title: string;
  body: string;
}

export interface AssembledRelatedCode {
  text: string;
  omittedCount: number;
  truncated: boolean;
}

const NEW_FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const TEST_FILE = /\.(?:spec|test)\.[jt]sx?$/;
export const isTestFile = (path: string): boolean => TEST_FILE.test(path);
// 맥락으로 실어 봐야 예산만 먹는 파일. 내용이 아니라 생성물이다.
const SKIPPED_FILE =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;

const DECLARATION =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const OBJECT_KEY = /^\s*([A-Za-z_$][\w$]*)\??\s*:/;

/**
 * diff 에서 파일별 바뀐 줄 범위(head 기준)를 뽑는다. 삭제된 파일(`+++ /dev/null`)과
 * lockfile 은 제외한다. `parseDiffHunks` 와 달리 순수 삭제 hunk(`+N,0`)도 지점으로 남긴다 —
 * 코드를 지운 자리의 앞뒤가 바로 리뷰가 봐야 할 맥락이다.
 */
export const parseChangedFileRanges = (diff: string): ChangedFileRanges[] => {
  const files: ChangedFileRanges[] = [];
  let current: ChangedFileRanges | null = null;
  for (const line of diff.split('\n')) {
    const fileMatch = line.match(NEW_FILE_HEADER);
    if (fileMatch) {
      const filePath = fileMatch[1].trim();
      current =
        filePath === '/dev/null' || SKIPPED_FILE.test(filePath)
          ? null
          : { filePath, ranges: [] };
      if (current) {
        files.push(current);
      }
      continue;
    }
    const hunkMatch = line.match(HUNK_HEADER);
    if (hunkMatch && current) {
      const start = Number(hunkMatch[1]);
      const count = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      current.ranges.push({
        start: Math.max(1, start),
        end: Math.max(1, count > 0 ? start + count - 1 : start),
      });
    }
  }
  return files.filter((file) => file.ranges.length > 0);
};

/**
 * diff 의 +/- 줄에서 바뀐 선언 이름을 뽑는다. 우선순위: export 선언 → 들여쓰기 없는 선언 →
 * 객체 키. 테스트 파일은 지역 변수 이름만 쏟아져 제외한다.
 *
 * ponytail: 정규식 휴리스틱이다 — 여러 줄에 걸친 선언·구조분해·데코레이터 뒤 이름은 놓친다.
 * 객체 키는 `select` 같은 흔한 단어가 검색을 낭비하므로 camelCase·snake 처럼 합성된 이름만 받는다.
 * 더 정확해야 하면 code-graph 의 tree-sitter 파서로 바꾼다.
 */
export const extractChangedSymbols = (
  diff: string,
  max: number = MAX_CHANGED_SYMBOLS,
): string[] => {
  const exported: string[] = [];
  const topLevel: string[] = [];
  const keys: string[] = [];
  let inTestFile = false;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inTestFile = TEST_FILE.test(line);
      continue;
    }
    if (inTestFile || line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (!line.startsWith('+') && !line.startsWith('-')) {
      continue;
    }
    const code = line.slice(1);
    const declaration = code.match(DECLARATION);
    if (declaration) {
      if (/^\s*export\b/.test(code)) {
        exported.push(declaration[1]);
      } else if (!/^\s/.test(code)) {
        topLevel.push(declaration[1]);
      }
      continue;
    }
    const key = code.match(OBJECT_KEY);
    if (key && /[A-Z_]/.test(key[1].slice(1))) {
      keys.push(key[1]);
    }
  }

  return [...new Set([...exported, ...topLevel, ...keys])].slice(0, max);
};

const numbered = (lines: string[], from: number, to: number): string =>
  lines
    .slice(from - 1, to)
    .map((text, index) => `${from + index}: ${text}`)
    .join('\n');

// 줄 범위를 앞뒤 `padding` 줄 넓혀 겹치거나 맞닿는 것끼리 합친다.
const mergeWindows = (
  ranges: { start: number; end: number }[],
  padding: number,
  lineCount: number,
): { start: number; end: number }[] => {
  const windows = ranges
    .map((range) => ({
      start: Math.max(1, range.start - padding),
      end: Math.min(lineCount, range.end + padding),
    }))
    .filter((window) => window.start <= window.end)
    .sort((left, right) => left.start - right.start);
  const merged: { start: number; end: number }[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end + 1) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
};

/** 바뀐 파일 본문: 400줄 이하면 전문, 넘으면 바뀐 구간 앞뒤 20줄 창만. 줄 번호를 붙인다. */
export const excerptChangedFile = (
  content: string,
  ranges: { start: number; end: number }[],
): string => {
  const lines = content.split('\n');
  if (lines.length <= FULL_FILE_MAX_LINES) {
    return numbered(lines, 1, lines.length);
  }
  return mergeWindows(ranges, HUNK_WINDOW_LINES, lines.length)
    .map((window) => numbered(lines, window.start, window.end))
    .join('\n...\n');
};

/** 사용처 파일에서 이름이 단어로 나오는 줄 앞뒤 몇 줄. 없으면 null. */
export const excerptUsages = (
  content: string,
  name: string,
  maxWindows: number,
): string | null => {
  const lines = content.split('\n');
  const escaped = name.replace(/[$]/g, '\\$');
  const pattern = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`);
  const hits = lines.flatMap((text, index) =>
    pattern.test(text) ? [{ start: index + 1, end: index + 1 }] : [],
  );
  if (hits.length === 0) {
    return null;
  }
  return mergeWindows(hits, USAGE_WINDOW_LINES, lines.length)
    .slice(0, maxWindows)
    .map((window) => numbered(lines, window.start, window.end))
    .join('\n...\n');
};

/**
 * 구간들을 순서대로 이어 붙이되 합계 `maxBytes` 를 넘기지 않는다. 처음 넘치는 구간은 줄 단위로
 * 잘라 남은 자리를 채우고, 그 뒤 구간은 뺀다. 앞에 둔 것(바뀐 파일)이 먼저 살아남는다.
 */
const TRUNCATED_MARK = '... (잘림)\n';

export const assembleRelatedCode = (
  sections: RelatedCodeSection[],
  maxBytes: number = RELATED_CODE_MAX_BYTES,
): AssembledRelatedCode => {
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  let omittedCount = 0;

  for (const section of sections) {
    if (truncated) {
      omittedCount += 1;
      continue;
    }
    // 구간 사이 빈 줄까지 조각에 넣어 센다 — 이어 붙인 결과가 상한을 넘지 않게.
    const piece = `### ${section.title}\n${section.body}\n\n`;
    const size = Buffer.byteLength(piece, 'utf-8');
    if (used + size <= maxBytes) {
      parts.push(piece);
      used += size;
      continue;
    }
    truncated = true;
    const budget = maxBytes - used - Buffer.byteLength(TRUNCATED_MARK, 'utf-8');
    const kept: string[] = [];
    let keptBytes = 0;
    for (const line of piece.split('\n')) {
      const lineBytes = Buffer.byteLength(`${line}\n`, 'utf-8');
      if (keptBytes + lineBytes > budget) {
        break;
      }
      kept.push(line);
      keptBytes += lineBytes;
    }
    // 제목만 남는 조각은 쓸모가 없어 통째로 뺀 것으로 센다.
    if (kept.length > 1) {
      parts.push(`${kept.join('\n')}\n${TRUNCATED_MARK}`);
    } else {
      omittedCount += 1;
    }
  }

  return { text: parts.join('').trimEnd(), omittedCount, truncated };
};
