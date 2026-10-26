import { HumanizeRuleLink } from './humanize-rule-links';

export type LinkCheckResult =
  | { id: string; status: 'same' | 'missing' | 'local-only' }
  | { id: string; status: 'changed'; before: string; after: string };

export const normalizeSnapshot = (source: string): string =>
  source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

export const extractQuickRuleRow = (
  markdown: string,
  ruleId: string,
): string | null => {
  const rows = markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.startsWith(`| ${ruleId} |`));
  if (rows.length > 1) {
    throw new Error(`Duplicate quick-rule row: ${ruleId}`);
  }
  return rows[0] ?? null;
};

export const compareLinks = (
  links: readonly HumanizeRuleLink[],
  current: Map<string, string | null>,
): LinkCheckResult[] =>
  links.map((link) => {
    if (link.upstream === null) {
      return { id: link.id, status: 'local-only' };
    }
    const source = current.get(link.id);
    if (source === undefined || source === null) {
      return { id: link.id, status: 'missing' };
    }
    const after = normalizeSnapshot(source);
    const before = normalizeSnapshot(link.upstreamSnapshot ?? '');
    if (before === after) {
      return { id: link.id, status: 'same' };
    }
    return { id: link.id, status: 'changed', before, after };
  });

export const findLocalTextOccurrences = (
  source: string,
  text: string,
): number => {
  if (text.length === 0) {
    return 0;
  }
  return source.split(text).length - 1;
};
