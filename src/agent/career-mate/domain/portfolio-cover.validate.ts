import { ProjectGroupNaming } from './project-group';

// 자리 구분 쉼표만 표기 차이로 취급한다. 부분 문자열 대조는 18을 180의 근거로 잘못 받는다.
const NUMBER_PATTERN = /(?<![\d.,])\d[\d,]*(?:\.\d+)?/g;
export const WORK_COUNT_PATTERN =
  /(?:\d+\s*(?:개|건|차)?\s*(?:PRs?|pull requests?|커밋|commits?|저장소))|(?:(?:PRs?|pull requests?|커밋|commits?|저장소)\s*\d+\s*(?:개|건)?)/i;
const TEST_WORD_PATTERN = /테스트|단위\s*테스트|\b(?:spec|suite|tests?)\b/i;
const TEST_PASS_PATTERN = /통과|\bpass(?:ed|es)?\b/i;

export const extractNumberTokens = (text: string): string[] =>
  (text.match(NUMBER_PATTERN) ?? []).map((token) => token.replace(/,/g, ''));

export const hasUngroundedNumbers = (
  text: string,
  processLines: string[],
): boolean => {
  const sourceTokens = new Set(extractNumberTokens(processLines.join('\n')));
  return extractNumberTokens(text).some((token) => !sourceTokens.has(token));
};

export const isTestPassCount = (text: string): boolean =>
  TEST_WORD_PATTERN.test(text) &&
  TEST_PASS_PATTERN.test(text) &&
  extractNumberTokens(text).length > 0;

const isWorkCount = (text: string): boolean => WORK_COUNT_PATTERN.test(text);

const validResultSentences = (text: string, processLines: string[]): string[] =>
  text
    // 마침표를 문장 쪽에 남긴 채 나눈다. 다시 이을 때 구분자를 붙이면 「다..」가 된다.
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .filter((sentence) => !isWorkCount(sentence))
    .filter((sentence) => !hasUngroundedNumbers(sentence, processLines));

export interface ValidatedCover extends ProjectGroupNaming {
  removedHighlights: string[];
  retryHighlights: boolean;
}

export const validateCover = (
  cover: ProjectGroupNaming,
  processLines: string[],
  previousResult: string,
): ValidatedCover | null => {
  if (!cover.title.trim() || !cover.summary.trim() || !cover.problem.trim()) {
    return null;
  }
  const highlights = cover.highlights
    .filter((item) => item.trim().length <= 40)
    .filter((item) => extractNumberTokens(item).length > 0)
    .filter((item) => !hasUngroundedNumbers(item, processLines))
    .filter((item) => !isWorkCount(item) && !isTestPassCount(item))
    .slice(0, 3);
  const resultSentences = validResultSentences(cover.result, processLines);
  const previousSentences = validResultSentences(previousResult, processLines);
  const removedHighlights = cover.highlights.filter(
    (item) => !highlights.includes(item),
  );
  return {
    ...cover,
    title: cover.title.trim(),
    summary: cover.summary.trim(),
    problem: cover.problem.trim(),
    result: (resultSentences.length > 0
      ? resultSentences
      : previousSentences
    ).join(' '),
    highlights,
    removedHighlights,
    retryHighlights:
      cover.highlights.length > 0 &&
      highlights.length === 0 &&
      extractNumberTokens(processLines.join('\n')).length > 0,
  };
};

export const shouldKeepPreviousTitle = (
  row: { coverOf: string | null; memberPrs: string[] } | null,
  memberPrs: string[],
): boolean => {
  if (!row || row.coverOf === null) {
    return false;
  }
  const previous = new Set(row.memberPrs);
  const next = new Set(memberPrs);
  const union = new Set([...previous, ...next]);
  if (union.size === 0) {
    return false;
  }
  const intersection = [...previous].filter((item) => next.has(item)).length;
  return intersection / union.size >= 0.8;
};
