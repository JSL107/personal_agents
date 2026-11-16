export enum HumanizeResearchSource {
  HUMANIZER = 'HUMANIZER',
  BLOG = 'BLOG',
  UPSTREAM = 'UPSTREAM',
  ARXIV = 'ARXIV',
  CANON_LOG = 'CANON_LOG',
}

export enum CollectionStatus {
  OK = 'OK',
  EMPTY = 'EMPTY',
  FAILED = 'FAILED',
}

export enum ProposalSkipReason {
  INVALID_SHAPE = 'INVALID_SHAPE',
  NO_EVIDENCE = 'NO_EVIDENCE',
  OVER_LIMIT = 'OVER_LIMIT',
  EVIDENCE_SOURCE_MISMATCH = 'EVIDENCE_SOURCE_MISMATCH',
  FILE_NOT_ALLOWED = 'FILE_NOT_ALLOWED',
  MATCH_NOT_UNIQUE = 'MATCH_NOT_UNIQUE',
  OUTSIDE_EDITABLE_SURFACE = 'OUTSIDE_EDITABLE_SURFACE',
  DELETE_NOT_ALLOWED = 'DELETE_NOT_ALLOWED',
  PROTECTED_ASSET = 'PROTECTED_ASSET',
  RULEBOOK_TOO_LONG = 'RULEBOOK_TOO_LONG',
}

export enum UpstreamRangeKind {
  ANCESTOR = 'ANCESTOR',
  RECENT = 'RECENT',
}

export interface CollectedItem {
  id: string;
  source: HumanizeResearchSource;
  text: string;
}

export interface CollectionResult {
  source: HumanizeResearchSource;
  status: CollectionStatus;
  items: CollectedItem[];
  error?: string;
}

export interface Processed {
  humanizerMaxRunId: string | null;
  blogPostIds: string[];
  upstreamHead: string | null;
  canonHead: string | null;
  arxivIds: string[];
}

// 값은 모델 출력 JSON 의 target 문자열과 같다.
export enum ProposalTarget {
  CANON = 'canon',
  BLOG = 'blog',
}

export interface EnforcementGap {
  ruleId: string;
  evidence: string[];
}

export interface HumanizeResearchProposal {
  target: ProposalTarget;
  file: string;
  oldString: string;
  newString: string;
  targetMetric: string;
  rationale: string;
  evidence: string[];
}

export interface SkippedHumanizeResearchProposal {
  proposal: Record<string, unknown>;
  reason: ProposalSkipReason;
}

export interface ConstrainedProposals {
  proposals: HumanizeResearchProposal[];
  skipped: SkippedHumanizeResearchProposal[];
}

export interface ParsedResearchOutput {
  enforcementGaps: EnforcementGap[];
  proposals: unknown[];
  injectionNotices: string[];
}

export interface SourceStatus {
  source: HumanizeResearchSource;
  status: CollectionStatus;
  itemCount: number;
  error?: string;
}

export interface HumanizeResearchOutput {
  enforcementGaps: EnforcementGap[];
  sources: SourceStatus[];
  droppedForBudget: string[];
  proposals: HumanizeResearchProposal[];
  skipped: SkippedHumanizeResearchProposal[];
  injectionNotices: string[];
  processed: Processed;
}

export interface HumanizeResearchRunResult {
  output: HumanizeResearchOutput;
  modelUsed: string;
  skippedForNoSources: boolean;
}

export interface ResearchInputSelection {
  quickRules: string;
  prompt: string;
  included: CollectedItem[];
  droppedForBudget: string[];
}

export interface UpstreamRange {
  kind: UpstreamRangeKind;
  args: string[];
}

export interface UpstreamCommit {
  hash: string;
  subject: string;
  patch: string;
}

export interface UpstreamSelection {
  text: string;
  lastHash: string;
  deferredCount: number;
}

export interface ArxivFields {
  id: string;
  title: string;
  summary: string;
  published: string;
}

export interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  published: Date;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
