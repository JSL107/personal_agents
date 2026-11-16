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
  const lines = [`발행 경로: ${path}`];
  const exampleStarts: number[] = [];
  for (const kind of EDIT_KINDS) {
    lines.push(`${kind}: ${summary.counts[kind]}건`);
    for (const example of summary.examples[kind]) {
      exampleStarts.push(lines.length);
      lines.push(`- 전: ${example.before.slice(0, MAX_EXAMPLE_LINE_LENGTH)}`);
      lines.push(`- 후: ${example.after.slice(0, MAX_EXAMPLE_LINE_LENGTH)}`);
    }
  }
  while (
    lines.join('\n').length > MAX_RENDER_LENGTH &&
    exampleStarts.length > 0
  ) {
    const start = exampleStarts.pop();
    if (start !== undefined) {
      lines.splice(start, 2);
    }
  }
  const rendered = lines.join('\n');
  return rendered.slice(0, MAX_RENDER_LENGTH);
};

export const hashBlogChanges = (changes: RevisionLineChanges): string => {
  const content = JSON.stringify([changes.removedLines, changes.addedLines]);
  const digest = createHash('sha1').update(content).digest('hex');
  return digest.slice(0, 8);
};

const emptySummary = (): BlogEditSummary => {
  const counts = {} as Record<BlogEditKind, number>;
  const examples = {} as Record<BlogEditKind, BlogEditExample[]>;
  for (const kind of EDIT_KINDS) {
    counts[kind] = 0;
    examples[kind] = [];
  }
  return { counts, examples };
};

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
  return (2 * matches) / (left.length + right.length - 2);
};
