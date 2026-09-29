import { LabeledFinding } from './review-replay.score';

// 이대리가 놓친 결함(미탐) 목록. 카드가 없으므로 원장에서 뽑을 수 없고 파일로 받는다.
// 외부 리뷰(gemini 등)와 대조한 조사 결과를 사람이 옮겨 적는 형식이라, 경로는 파일 이름만 있어도 된다.
// headSha 를 비우면 원장에서 그 PR 을 가장 최근에 리뷰한 커밋을 찾는다.
export interface MissedFindingEntry {
  repo: string;
  pullNumber: number;
  filePath: string;
  line: number | null;
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
      entry.line === null || isPositiveInteger(entry.line)
        ? null
        : 'line 은 양의 정수 또는 null',
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
      line: entry.line as number | null,
      body: entry.body as string,
      ...(entry.headSha === undefined
        ? {}
        : { headSha: entry.headSha as string }),
    });
  });
  return { entries, errors };
};

// 미탐은 카드 id 가 없으므로 음수로 번호를 붙인다 — 카드 id(양수)와 섞여도 겹치지 않게.
export const toMissedLabeledFinding = (
  entry: MissedFindingEntry,
  index: number,
): LabeledFinding => ({
  id: -(index + 1),
  label: 'MISSED',
  filePath: entry.filePath,
  line: entry.line,
  category: '',
  body: entry.body,
});
