import { INDEX_TARGET_BYTES } from './memory-index.analyzer';
import {
  INDEX_ENTRY_PATTERN,
  MemoryDiagnosis,
  MemoryFile,
  MemoryIndexSnapshot,
  VacuumAction,
  VacuumOutcome,
} from './memory-index.type';

// 설명 절단 단계. 목표에 닿을 때까지 위에서부터 적용하고, 닿으면 멈춘다.
// 0 은 설명을 통째로 뺀다 — recall 판정은 각 파일의 frontmatter description 이 하므로
// 색인의 설명은 "무엇이 있는지" 를 넘어선 중복이다.
const HOOK_BUDGETS = [60, 40, 0];
// 고아를 올릴 자리. 없으면 파일 끝에 붙인다.
const INDIVIDUAL_HEADING = '## 개별';

const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

// 바이트 예산에 맞춰 자른다. 문자 단위로 줄여야 한글 낱자가 깨지지 않는다.
const clampToBytes = (value: string, budget: number): string => {
  let clamped = value;
  while (byteLength(clamped) > budget) {
    clamped = clamped.slice(0, -1);
  }
  return clamped;
};

export const trimHook = (hook: string, budget: number): string => {
  if (budget <= 0) {
    return '';
  }
  let trimmed = hook.replace(/…$/, '').replace(/\*\*/g, '').trim();
  const sentenceEnd = trimmed.indexOf('. ');
  if (sentenceEnd > 0) {
    trimmed = trimmed.slice(0, sentenceEnd);
  }
  trimmed = clampToBytes(trimmed, budget);
  return trimmed.replace(/[.·,—\s(]+$/, '').trim();
};

// 묶음 줄은 접두 하나를 통째로 대표하므로 설명이 곧 그 묶음의 목차다. 자르면 안 된다.
const isFoldLine = (line: string): boolean => line.includes('`ls ');

const applyHookBudget = (lines: string[], budget: number): string[] => {
  return lines.map((line) => {
    const matched = INDEX_ENTRY_PATTERN.exec(line.trim());
    if (matched === null || matched[3] === undefined || isFoldLine(line)) {
      return line;
    }
    const hook = trimHook(matched[3], budget);
    const head = `- [${matched[1]}](${matched[2]})`;
    return hook.length > 0 ? `${head} — ${hook}` : head;
  });
};

const toOrphanLine = (file: MemoryFile): string => {
  return `- [${file.title}](${file.fileName})`;
};

const insertOrphanLines = (
  lines: string[],
  orphanLines: string[],
): string[] => {
  if (orphanLines.length === 0) {
    return lines;
  }
  const headingAt = lines.findIndex(
    (line) => line.trim() === INDIVIDUAL_HEADING,
  );
  if (headingAt < 0) {
    return [...lines, ...orphanLines];
  }
  // 헤딩 바로 다음이 빈 줄이면 그 아래에 넣어 문서 모양을 유지한다.
  const insertAt =
    lines[headingAt + 1]?.trim() === '' ? headingAt + 2 : headingAt + 1;
  return [
    ...lines.slice(0, insertAt),
    ...orphanLines,
    ...lines.slice(insertAt),
  ];
};

// 결정론 청소 — 손실이 없거나(고아 등록·죽은 줄 제거) 파일 본문에 원본이 남는(설명 절단)
// 작업만 한다. 묶음·폐기는 의미 판단이라 여기서 하지 않고 진단으로만 알린다.
export const vacuumMemoryIndex = (
  snapshot: MemoryIndexSnapshot,
  diagnosis: MemoryDiagnosis,
): VacuumOutcome => {
  const actions: VacuumAction[] = [];
  const broken = new Set(diagnosis.dust.brokenLinks);
  let lines = snapshot.indexContent.split('\n');

  if (broken.size > 0) {
    const before = lines.length;
    lines = lines.filter((line) => {
      const matched = INDEX_ENTRY_PATTERN.exec(line.trim());
      return matched === null || !broken.has(matched[2]);
    });
    actions.push({
      type: 'broken_link_removed',
      count: before - lines.length,
    });
  }

  if (diagnosis.dust.orphans.length > 0) {
    const orphanSet = new Set(diagnosis.dust.orphans);
    const orphanLines = snapshot.files
      .filter((file) => orphanSet.has(file.fileName))
      .map(toOrphanLine);
    lines = insertOrphanLines(lines, orphanLines);
    actions.push({ type: 'orphan_indexed', count: orphanLines.length });
  }

  // 고아를 올리면 색인이 오히려 커진다 — 절단은 반드시 그 뒤에 재야 한다.
  for (const budget of HOOK_BUDGETS) {
    if (byteLength(lines.join('\n')) <= INDEX_TARGET_BYTES) {
      break;
    }
    const trimmed = applyHookBudget(lines, budget);
    const changed = trimmed.filter(
      (line, position) => line !== lines[position],
    ).length;
    lines = trimmed;
    if (changed > 0) {
      const previous = actions.find((action) => action.type === 'hook_trimmed');
      if (previous === undefined) {
        actions.push({ type: 'hook_trimmed', count: changed });
      } else {
        previous.count = changed;
      }
    }
  }

  const nextIndexContent = lines.join('\n');
  const changed = nextIndexContent !== snapshot.indexContent;
  return {
    project: snapshot.project,
    before: diagnosis,
    actions: actions.filter((action) => action.count > 0),
    nextIndexContent: changed ? nextIndexContent : null,
    remainingOverflowBytes: Math.max(
      0,
      byteLength(nextIndexContent) - INDEX_TARGET_BYTES,
    ),
  };
};
