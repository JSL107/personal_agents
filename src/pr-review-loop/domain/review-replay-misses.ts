import { LabeledFinding } from './review-replay.score';

// 이대리가 놓친 결함(미탐) 목록. 카드가 없으므로 원장에서 뽑을 수 없고 파일로 받는다.
// 외부 리뷰(gemini 등)와 대조한 조사 결과를 사람이 옮겨 적는 형식이라, 경로는 파일 이름만 있어도 된다.
// headSha 를 비우면 원장에서 그 PR 을 가장 최근에 리뷰한 커밋을 찾는다.
export interface MissedFindingEntry {
  repo: string;
  pullNumber: number;
  filePath: string;
  // 필수다 — 미탐은 분류(category)가 없어 줄 없이는 재생 지적과 맞출 근거가 없다.
  line: number;
  body: string;
  headSha?: string;
}

export interface ParsedMisses {
  entries: MissedFindingEntry[];
  errors: string[];
}

const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

// 형식이 틀린 항목은 버리지 않고 사유를 모아 돌려준다 — 호출자가 모델을 부르기 전에 멈출 수 있게.
export const parseMissedFindings = (raw: unknown): ParsedMisses => {
  if (!Array.isArray(raw)) {
    return { entries: [], errors: ['최상위가 배열이 아니다'] };
  }
  const entries: MissedFindingEntry[] = [];
  const errors: string[] = [];
  raw.forEach((item: unknown, index) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const problems = [
      typeof entry.repo === 'string' && REPO_PATTERN.test(entry.repo)
        ? null
        : 'repo 는 owner/repo',
      isPositiveInteger(entry.pullNumber) ? null : 'pullNumber 는 양의 정수',
      typeof entry.filePath === 'string' && entry.filePath.trim() !== ''
        ? null
        : 'filePath 가 비었다',
      isPositiveInteger(entry.line) ? null : 'line 은 양의 정수',
      typeof entry.body === 'string' ? null : 'body 는 문자열',
      entry.headSha === undefined ||
      (typeof entry.headSha === 'string' && entry.headSha !== '')
        ? null
        : 'headSha 는 비지 않은 문자열',
    ].filter((problem): problem is string => problem !== null);
    if (problems.length > 0) {
      errors.push(`${index}번 항목: ${problems.join(', ')}`);
      return;
    }
    entries.push({
      repo: entry.repo as string,
      pullNumber: entry.pullNumber as number,
      filePath: entry.filePath as string,
      line: entry.line as number,
      body: entry.body as string,
      ...(entry.headSha === undefined
        ? {}
        : { headSha: entry.headSha as string }),
    });
  });
  return { entries, errors };
};

// 미탐은 카드 id 가 없어 내용에서 고정 id 를 만든다(음수 — 카드 id 와 겹치지 않게).
// 목록 순서로 번호를 매기면 순서를 바꾸거나 다른 항목을 넣었을 때 다른 결함이 같은 id 를 받아,
// 기준선의 표본 동일성 판정이 틀린다. 같은 결함이면 목록이 바뀌어도 같은 id 가 나온다.
export const missedFindingId = (entry: MissedFindingEntry): number => {
  const key = [
    entry.repo.toLowerCase(),
    entry.pullNumber,
    entry.filePath,
    entry.line,
    entry.body,
  ].join('\u0000');
  // FNV-1a 32bit
  let hash = 0x811c9dc5;
  for (const char of key) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return -((hash % 0x7fffffff) + 1);
};

export const toMissedLabeledFinding = (
  entry: MissedFindingEntry,
): LabeledFinding => ({
  id: missedFindingId(entry),
  label: 'MISSED',
  filePath: entry.filePath,
  line: entry.line,
  category: '',
  body: entry.body,
});

export type MissPathResolution =
  | { kind: 'full'; filePath: string }
  | { kind: 'resolved'; filePath: string }
  | { kind: 'not-in-diff'; filePath: string }
  | { kind: 'ambiguous'; filePath: string; candidates: string[] };

// 파일 이름만 있는 미탐을 그 PR diff 의 변경 파일에서 찾아 전체 경로로 바꾼다. 이름만으로 매칭하면
// 같은 PR 의 다른 디렉터리 동명 파일(index.ts 등)을 잡는다. 후보가 하나일 때만 바꾸고,
// 없거나 여럿이면 이름 그대로 두되 호출자가 보고서에 남기도록 종류를 돌려준다.
export const resolveMissPath = (
  filePath: string,
  changedFiles: readonly string[],
): MissPathResolution => {
  if (filePath.includes('/')) {
    return { kind: 'full', filePath };
  }
  const candidates = changedFiles.filter(
    (changed) => changed.split('/').pop() === filePath,
  );
  if (candidates.length === 1) {
    return { kind: 'resolved', filePath: candidates[0] };
  }
  return candidates.length === 0
    ? { kind: 'not-in-diff', filePath }
    : { kind: 'ambiguous', filePath, candidates };
};
