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

export interface HumanizeResearchOutput {
  sources: Array<{
    source: HumanizeResearchSource;
    status: CollectionStatus;
    itemCount: number;
    error?: string;
  }>;
  droppedForBudget: string[];
  proposals: HumanizeResearchProposal[];
  skipped: SkippedHumanizeResearchProposal[];
  injectionNotices: string[];
  processed: Processed;
}
