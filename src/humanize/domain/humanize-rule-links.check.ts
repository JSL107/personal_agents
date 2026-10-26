import {
  CompareLinksParams,
  ExtractQuickRuleRowParams,
  HasUnresolvedDriftParams,
  LinkCheckResult,
  LinkStatus,
  NormalizeSnapshotParams,
  PythonSymbolUpstream,
  QuickRuleUpstream,
  UpstreamSource,
} from './humanize-rule-links.type';

// 값 하나의 종류를 가르는 타입 가드는 `filter` 에 그대로 넘기려고 위치 인자로 둔다
// (CODE_RULES §3-11 의 「라이브러리가 인자 형태를 정하는 경우」 예외와 같은 이유).
export const isPythonSymbolUpstream = (
  upstream: UpstreamSource | null,
): upstream is PythonSymbolUpstream => upstream?.kind === 'python-symbol';

export const isQuickRuleUpstream = (
  upstream: UpstreamSource | null,
): upstream is QuickRuleUpstream => upstream?.kind === 'quick-rule';

export const normalizeSnapshot = ({
  source,
}: NormalizeSnapshotParams): string => {
  const normalized = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
  return normalized;
};

export const extractQuickRuleRow = ({
  markdown,
  ruleId,
}: ExtractQuickRuleRowParams): string | null => {
  const rows = markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.startsWith(`| ${ruleId} |`));
  if (rows.length > 1) {
    throw new Error(`Duplicate quick-rule row: ${ruleId}`);
  }
  return rows[0] ?? null;
};

export const compareLinks = ({
  links,
  current,
  snapshots,
}: CompareLinksParams): LinkCheckResult[] =>
  links.map((link) => {
    if (link.upstream === null) {
      return { id: link.id, status: LinkStatus.LOCAL_ONLY };
    }
    const source = current.get(link.id);
    if (source === undefined || source === null) {
      return { id: link.id, status: LinkStatus.MISSING };
    }
    const after = normalizeSnapshot({ source });
    const before = normalizeSnapshot({ source: snapshots[link.id] ?? '' });
    if (before === after) {
      return { id: link.id, status: LinkStatus.SAME };
    }
    return { id: link.id, status: LinkStatus.CHANGED, before, after };
  });

export const hasUnresolvedDrift = ({
  results,
  accept,
}: HasUnresolvedDriftParams): boolean => {
  const unresolved = results.some(
    ({ status }) =>
      status === LinkStatus.MISSING ||
      (status === LinkStatus.CHANGED && !accept),
  );
  return unresolved;
};
