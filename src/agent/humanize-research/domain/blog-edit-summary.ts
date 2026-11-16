import { createHash } from 'node:crypto';

import { RevisionLineChanges } from '../../blog/domain/revision-rate';

export enum BlogEditKind {
  PUNCTUATION_ONLY = 'PUNCTUATION_ONLY',
  LEXICAL = 'LEXICAL',
  REWRITE = 'REWRITE',
  DELETED = 'DELETED',
  ADDED = 'ADDED',
}

export interface BlogEditExample {
  before: string;
  after: string;
}

export interface BlogEditSummary {
  counts: Record<BlogEditKind, number>;
  examples: Record<BlogEditKind, BlogEditExample[]>;
}

const EDIT_KINDS = Object.values(BlogEditKind);
const MAX_EXAMPLES = 3;
const MAX_RENDER_LENGTH = 4000;
const MAX_EXAMPLE_LINE_LENGTH = 300;
const EXAMPLE_CONTEXT_BEFORE_CHANGE = 80;

export const summarizeBlogEdits = (
  changes: RevisionLineChanges,
): BlogEditSummary => {
  const summary = emptySummary();
  const removedLines = changes.removedLines.filter(
    (line) => line.trim() !== '',
  );
  const addedLines = changes.addedLines.filter((line) => line.trim() !== '');
  const usedAddedIndexes = new Set<number>();

  for (const removed of removedLines) {
    const best = addedLines.reduce(
      (result, added, index) => {
        if (usedAddedIndexes.has(index)) {
          return result;
        }
        const score = diceCoefficient({
          before: removed,
          after: added,
        });
        if (score > result.score) {
          return { index, score };
        }
        return result;
      },
      { index: -1, score: 0 },
    );

    if (best.index < 0 || best.score < 0.5) {
      addExample({
        summary,
        kind: BlogEditKind.DELETED,
        example: { before: removed, after: '' },
      });
      continue;
    }

    usedAddedIndexes.add(best.index);
    const added = addedLines[best.index];
    const kind = classifyPair({ removed, added, score: best.score });
    addExample({ summary, kind, example: { before: removed, after: added } });
  }

  for (const [index, added] of addedLines.entries()) {
    if (!usedAddedIndexes.has(index)) {
      addExample({
        summary,
        kind: BlogEditKind.ADDED,
        example: { before: '', after: added },
      });
    }
  }
  return summary;
};

export const renderBlogEditSummary = ({
  path,
  summary,
}: {
  path: string;
  summary: BlogEditSummary;
}): string => {
  const title = `발행 경로: ${path}`;
  const countLines = EDIT_KINDS.map(
    (kind) => `${kind}: ${summary.counts[kind]}건`,
  );
  const blocks = EDIT_KINDS.flatMap((kind) =>
    summary.examples[kind].map((example) => ({
      kind,
      text: renderExample(example),
    })),
  );
  const fixedLength = [title, ...countLines].join('\n').length;
  // 상한을 넘으면 뒤쪽 예시부터 버린다 — 앞에서부터 들어가는 만큼만 남기는 것과 같다.
  const keptCount = countFittingBlocks({
    lengths: blocks.map((block) => block.text.length),
    budget: MAX_RENDER_LENGTH - fixedLength,
  });
  const kept = blocks.slice(0, keptCount);
  const kindSections = EDIT_KINDS.flatMap((kind, index) => [
    countLines[index],
    ...kept.filter((block) => block.kind === kind).map((block) => block.text),
  ]);
  const rendered = [title, ...kindSections].join('\n');
  return rendered.slice(0, MAX_RENDER_LENGTH);
};

const renderExample = (example: BlogEditExample): string => {
  const cropped = cropAroundChange(example);
  const text = `- 전: ${cropped.before}\n- 후: ${cropped.after}`;
  return text;
};

// 줄바꿈 하나씩을 더해 누적하면서, 예산 안에 처음부터 연속으로 들어가는 블록 수를 센다.
const countFittingBlocks = ({
  lengths,
  budget,
}: {
  lengths: number[];
  budget: number;
}): number => {
  const cumulative = lengths.reduce<number[]>((totals, length) => {
    const previous = totals.at(-1) ?? 0;
    totals.push(previous + length + 1);
    return totals;
  }, []);
  const firstOver = cumulative.findIndex((total) => total > budget);
  const count = firstOver < 0 ? lengths.length : firstOver;
  return count;
};

// 블로그는 문단 하나가 한 줄이라 앞에서 자르면 뒤쪽 수정이 사라진다. 처음 달라지는 지점 앞뒤를 남긴다.
const cropAroundChange = ({
  before,
  after,
}: BlogEditExample): BlogEditExample => {
  const beforeCharacters = [...before];
  const afterCharacters = [...after];
  const firstDiff = beforeCharacters.findIndex(
    (character, index) => character !== afterCharacters[index],
  );
  const changeAt = firstDiff < 0 ? beforeCharacters.length : firstDiff;
  const start = Math.max(0, changeAt - EXAMPLE_CONTEXT_BEFORE_CHANGE);
  const marker = start > 0 ? '…' : '';
  const crop = (characters: string[]): string =>
    `${marker}${characters.slice(start, start + MAX_EXAMPLE_LINE_LENGTH).join('')}`;
  return { before: crop(beforeCharacters), after: crop(afterCharacters) };
};

export const hashBlogChanges = (changes: RevisionLineChanges): string => {
  const content = JSON.stringify([changes.removedLines, changes.addedLines]);
  const digest = createHash('sha1').update(content).digest('hex');
  return digest.slice(0, 8);
};

const emptySummary = (): BlogEditSummary => ({
  counts: {
    [BlogEditKind.PUNCTUATION_ONLY]: 0,
    [BlogEditKind.LEXICAL]: 0,
    [BlogEditKind.REWRITE]: 0,
    [BlogEditKind.DELETED]: 0,
    [BlogEditKind.ADDED]: 0,
  },
  examples: {
    [BlogEditKind.PUNCTUATION_ONLY]: [],
    [BlogEditKind.LEXICAL]: [],
    [BlogEditKind.REWRITE]: [],
    [BlogEditKind.DELETED]: [],
    [BlogEditKind.ADDED]: [],
  },
});

const addExample = ({
  summary,
  kind,
  example,
}: {
  summary: BlogEditSummary;
  kind: BlogEditKind;
  example: BlogEditExample;
}): void => {
  summary.counts[kind] += 1;
  if (summary.examples[kind].length < MAX_EXAMPLES) {
    summary.examples[kind].push(example);
  }
};

const classifyPair = ({
  removed,
  added,
  score,
}: {
  removed: string;
  added: string;
  score: number;
}): BlogEditKind => {
  if (normalizeLine(removed) === normalizeLine(added)) {
    return BlogEditKind.PUNCTUATION_ONLY;
  }
  if (score >= 0.8) {
    return BlogEditKind.LEXICAL;
  }
  return BlogEditKind.REWRITE;
};

const normalizeLine = (line: string): string => {
  return line.replace(/[\s\p{P}]/gu, '');
};

const diceCoefficient = ({
  before,
  after,
}: {
  before: string;
  after: string;
}): number => {
  const left = normalizeLine(before);
  const right = normalizeLine(after);
  if (left === right) {
    return 1;
  }
  if (left.length < 2 || right.length < 2) {
    return 0;
  }
  const bigrams = new Map<string, number>();
  for (const index of Array.from(
    { length: left.length - 1 },
    (_, index) => index,
  )) {
    const bigram = left.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  const matches = Array.from(
    { length: right.length - 1 },
    (_, index) => index,
  ).reduce((count, index) => {
    const bigram = right.slice(index, index + 2);
    const remaining = bigrams.get(bigram) ?? 0;
    if (remaining > 0) {
      bigrams.set(bigram, remaining - 1);
      return count + 1;
    }
    return count;
  }, 0);
  const coefficient = (2 * matches) / (left.length + right.length - 2);
  return coefficient;
};
