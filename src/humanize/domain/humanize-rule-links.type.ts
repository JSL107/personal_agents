export type QuickRuleUpstream = { kind: 'quick-rule'; ruleId: string };
export type PythonSymbolUpstream = { kind: 'python-symbol'; symbol: string };
export type UpstreamSource = QuickRuleUpstream | PythonSymbolUpstream;

export type HumanizeRuleLink = {
  id: string;
  local: { file: string; text: string };
  upstream: UpstreamSource | null;
  note: string;
};

export enum LinkStatus {
  SAME = 'same',
  CHANGED = 'changed',
  MISSING = 'missing',
  LOCAL_ONLY = 'local-only',
}

export type LinkCheckResult =
  | {
      id: string;
      status: LinkStatus.SAME | LinkStatus.MISSING | LinkStatus.LOCAL_ONLY;
    }
  | { id: string; status: LinkStatus.CHANGED; before: string; after: string };

export type PythonSnapshots = Record<string, string | null>;
export type UpstreamSnapshots = Record<string, string>;
export type CheckOptions = { repository: string; accept: boolean };
export type ParseOptionsParams = { argumentsList: string[] };
export type LoadPythonSnapshotsParams = { references: string };
export type LoadCurrentParams = { repository: string };
export type AcceptSnapshotsParams = { results: readonly LinkCheckResult[] };
export type PrintResultsParams = { results: readonly LinkCheckResult[] };
export type NormalizeSnapshotParams = { source: string };
export type ExtractQuickRuleRowParams = { markdown: string; ruleId: string };
export type CompareLinksParams = {
  links: readonly HumanizeRuleLink[];
  current: Map<string, string | null>;
  snapshots: UpstreamSnapshots;
};
export type HasUnresolvedDriftParams = {
  results: readonly LinkCheckResult[];
  accept: boolean;
};
