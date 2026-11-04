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

// 성과 줄을 버리는 사유. null 이면 싣는다. 사유는 재요청 프롬프트에 그대로 실려 모델이 같은 실수를 반복하지 않게 한다.
// 조건을 차례로 걸러내는 가드라 ts-pattern 대신 early return 을 쓴다(CODE_RULES §1-4).
export const highlightRejectionReason = ({
  highlight,
  processLines,
}: {
  highlight: string;
  processLines: string[];
}): string | null => {
  if (highlight.trim().length > HIGHLIGHT_MAX_LENGTH) {
    return `${HIGHLIGHT_MAX_LENGTH}자 초과`;
  }
  if (extractNumberTokens(highlight).length === 0) {
    return '숫자 없음';
  }
  const ungrounded = hasUngroundedNumbers({ text: highlight, processLines });
  if (ungrounded) {
    return '과정 10줄에 없는 숫자';
  }
  if (isWorkCount(highlight)) {
    return 'PR·커밋·저장소 작업 건수';
  }
  if (isTestPassCount(highlight)) {
    return '테스트 통과 수';
  }
  return null;
};

export interface RemovedHighlight {
  highlight: string;
  reason: string;
}

export interface ValidatedCover extends ProjectGroupNaming {
  removedHighlights: RemovedHighlight[];
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
  const judged = cover.highlights.map((highlight) => ({
    highlight,
    reason: highlightRejectionReason({ highlight, processLines }),
  }));
  const highlights = judged
    .filter(({ reason }) => reason === null)
    .map(({ highlight }) => highlight)
    .slice(0, HIGHLIGHT_MAX_COUNT);
  const removedHighlights = judged.filter(
    (item): item is RemovedHighlight => item.reason !== null,
  );
  const resultSentences = validResultSentences({
    text: cover.result,
    processLines,
  });
  const previousSentences = validResultSentences({
    text: previousResult,
    processLines,
  });
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
