import {
  FOLD_MARKER_PATTERN,
  FoldCandidate,
  INDEX_ENTRY_PATTERN,
  MemoryDiagnosis,
  MemoryIndexSnapshot,
} from './memory-index.type';

// 색인 실효 상한. 넘으면 뒷부분이 로드되지 않는다(2026-09-09 실측: 30,835바이트까지 실렸다).
export const INDEX_SIZE_LIMIT_BYTES = 30_720;
// 청소 목표. 상한에 딱 맞추면 다음 기억 한 줄에 바로 다시 넘치므로 여유를 둔다.
export const INDEX_TARGET_BYTES = 26_000;
// 묶음 제안 최소 개수. 2개를 묶어봐야 한 줄 줄어드는데 recall 손실은 그대로라 셈이 안 맞는다.
export const FOLD_MIN_FILES = 3;

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

// 색인이 링크로 직접 가리키는 파일명들.
export const collectIndexedFiles = (indexContent: string): Set<string> => {
  const indexed = new Set<string>();
  for (const line of indexContent.split('\n')) {
    const matched = INDEX_ENTRY_PATTERN.exec(line.trim());
    if (matched !== null) {
      indexed.add(matched[2]);
    }
  }
  return indexed;
};

// 묶음 줄이 대표하는 접두들. `- [오피스 화면 19건](...) — ... `ls project_office_*`` 형태.
export const collectFoldedPrefixes = (indexContent: string): string[] => {
  const prefixes: string[] = [];
  for (const matched of indexContent.matchAll(FOLD_MARKER_PATTERN)) {
    prefixes.push(matched[1]);
  }
  return prefixes;
};

const isCoveredByFold = (
  fileName: string,
  foldedPrefixes: string[],
): boolean => {
  return foldedPrefixes.some((prefix) => fileName.startsWith(prefix));
};

// 파일명 앞 두 마디를 주제 키로 본다(feedback_codex_review.md → feedback_codex).
const toPrefixKey = (fileName: string): string | null => {
  const parts = fileName.replace(/\.md$/, '').split('_');
  if (parts.length < 3) {
    return null;
  }
  return `${parts[0]}_${parts[1]}_`;
};

const collectFoldCandidates = (
  fileNames: string[],
  foldedPrefixes: string[],
): FoldCandidate[] => {
  const counts = new Map<string, number>();
  for (const fileName of fileNames) {
    if (isCoveredByFold(fileName, foldedPrefixes)) {
      continue;
    }
    const key = toPrefixKey(fileName);
    if (key === null) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const candidates: FoldCandidate[] = [];
  for (const [prefix, count] of counts) {
    if (count >= FOLD_MIN_FILES) {
      candidates.push({ prefix, count });
    }
  }
  return candidates.sort((left, right) => right.count - left.count);
};

// 결정론 진단 — LLM 없이 파일 목록과 색인 문자열만으로 판정한다.
export const diagnoseMemoryIndex = (
  snapshot: MemoryIndexSnapshot,
): MemoryDiagnosis => {
  const indexed = collectIndexedFiles(snapshot.indexContent);
  const foldedPrefixes = collectFoldedPrefixes(snapshot.indexContent);
  const fileNames = snapshot.files.map((file) => file.fileName);
  const existing = new Set(fileNames);

  const orphans = fileNames.filter(
    (fileName) =>
      !indexed.has(fileName) && !isCoveredByFold(fileName, foldedPrefixes),
  );
  const brokenLinks = [...indexed].filter(
    (fileName) => !existing.has(fileName),
  );
  const indexBytes = byteLength(snapshot.indexContent);

  return {
    project: snapshot.project,
    indexBytes,
    entryCount: indexed.size,
    fileCount: fileNames.length,
    dust: {
      orphans,
      brokenLinks,
      overflowBytes: Math.max(0, indexBytes - INDEX_SIZE_LIMIT_BYTES),
    },
    foldCandidates: collectFoldCandidates(fileNames, foldedPrefixes),
  };
};
