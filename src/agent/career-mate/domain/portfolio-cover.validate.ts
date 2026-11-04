import { ProjectGroupNaming } from './project-group';

// 자리 구분 쉼표만 표기 차이로 취급한다. 부분 문자열 대조는 18을 180의 근거로 잘못 받는다.
const NUMBER_PATTERN = /(?<![\d.,])\d[\d,]*(?:\.\d+)?/g;
export const WORK_COUNT_PATTERN =
  /(?:\d+\s*(?:개|건|차)?\s*(?:PRs?|pull requests?|커밋|commits?|저장소))|(?:(?:PRs?|pull requests?|커밋|commits?|저장소)\s*\d+\s*(?:개|건)?)/i;
const TEST_WORD_PATTERN = /테스트|단위\s*테스트|\b(?:spec|suite|tests?)\b/i;
const TEST_PASS_PATTERN = /통과|\bpass(?:ed|es)?\b/i;
const HIGHLIGHT_MAX_LENGTH = 40;
const HIGHLIGHT_MAX_COUNT = 3;
const TITLE_KEEP_JACCARD = 0.8;

export const extractNumberTokens = (text: string): string[] => {
  const matches = text.match(NUMBER_PATTERN) ?? [];
  const tokens = matches.map((token) => token.replace(/,/g, ''));
  return tokens;
};

export const hasUngroundedNumbers = ({
  text,
  processLines,
}: {
  text: string;
  processLines: string[];
}): boolean => {
  const sourceTokens = new Set(extractNumberTokens(processLines.join('\n')));
  const tokens = extractNumberTokens(text);
  const hasUnknownToken = tokens.some((token) => !sourceTokens.has(token));
  return hasUnknownToken;
};

export const isTestPassCount = (text: string): boolean => {
  const mentionsTest = TEST_WORD_PATTERN.test(text);
  const mentionsPass = TEST_PASS_PATTERN.test(text);
  const hasNumber = extractNumberTokens(text).length > 0;
  const isPassCount = mentionsTest && mentionsPass && hasNumber;
  return isPassCount;
};

const isWorkCount = (text: string): boolean => WORK_COUNT_PATTERN.test(text);

const validResultSentences = ({
  text,
  processLines,
}: {
  text: string;
  processLines: string[];
}): string[] => {
  const sentences = text
    // 마침표를 문장 쪽에 남긴 채 나눈다. 다시 이을 때 구분자를 붙이면 「다..」가 된다.
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .filter((sentence) => !isWorkCount(sentence))
    .filter(
      (sentence) => !hasUngroundedNumbers({ text: sentence, processLines }),
    );
  return sentences;
};

const isPresentableHighlight = ({
  highlight,
  processLines,
}: {
  highlight: string;
  processLines: string[];
}): boolean => {
  if (highlight.trim().length > HIGHLIGHT_MAX_LENGTH) {
    return false;
  }
  if (extractNumberTokens(highlight).length === 0) {
    return false;
  }
  if (hasUngroundedNumbers({ text: highlight, processLines })) {
    return false;
  }
  if (isWorkCount(highlight) || isTestPassCount(highlight)) {
    return false;
  }
  return true;
};

export interface ValidatedCover extends ProjectGroupNaming {
  removedHighlights: string[];
  retryHighlights: boolean;
}

export const validateCover = ({
  cover,
  processLines,
  previousResult,
}: {
  cover: ProjectGroupNaming;
  processLines: string[];
  previousResult: string;
}): ValidatedCover | null => {
  if (!cover.title.trim() || !cover.summary.trim() || !cover.problem.trim()) {
    return null;
  }
  const highlights = cover.highlights
    .filter((highlight) => isPresentableHighlight({ highlight, processLines }))
    .slice(0, HIGHLIGHT_MAX_COUNT);
  const resultSentences = validResultSentences({
    text: cover.result,
    processLines,
  });
  const previousSentences = validResultSentences({
    text: previousResult,
    processLines,
  });
  const removedHighlights = cover.highlights.filter(
    (item) => !highlights.includes(item),
  );
  const selectedSentences =
    resultSentences.length > 0 ? resultSentences : previousSentences;
  const result = selectedSentences.join(' ');
  const processHasNumbers =
    extractNumberTokens(processLines.join('\n')).length > 0;
  const retryHighlights =
    cover.highlights.length > 0 && highlights.length === 0 && processHasNumbers;
  return {
    ...cover,
    title: cover.title.trim(),
    summary: cover.summary.trim(),
    problem: cover.problem.trim(),
    result,
    highlights,
    removedHighlights,
    retryHighlights,
  };
};

export const shouldKeepPreviousTitle = ({
  row,
  memberPrs,
}: {
  row: { coverOf: string | null; memberPrs: string[] } | null;
  memberPrs: string[];
}): boolean => {
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
  const jaccard = intersection / union.size;
  return jaccard >= TITLE_KEEP_JACCARD;
};
