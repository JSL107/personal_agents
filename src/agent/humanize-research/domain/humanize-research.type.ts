export enum HumanizeResearchSource {
  HUMANIZER = 'HUMANIZER',
  BLOG = 'BLOG',
  UPSTREAM = 'UPSTREAM',
  ARXIV = 'ARXIV',
  SAMPLE = 'SAMPLE',
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
  arxivIds: string[];
}

export interface HumanizeResearchProposal {
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

export interface SampleTopic {
  key: string;
  prompt: string;
}

export interface SampleOutcome {
  item?: CollectedItem;
  failure?: string;
}
