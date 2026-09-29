export const APPLICABILITY_VERDICT = {
  APPLY: 'APPLY',
  REFERENCE: 'REFERENCE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type ApplicabilityVerdict =
  (typeof APPLICABILITY_VERDICT)[keyof typeof APPLICABILITY_VERDICT];

export interface ApplicabilityProposal {
  title: string;
  problem: string;
  change: string;
  verify: string;
}

export interface RawApplicabilityOutput {
  verdict: ApplicabilityVerdict;
  reason: string;
  citations: { chunkId: string; why: string }[];
  proposal: ApplicabilityProposal | null;
}

export interface ApplicabilityCitation {
  filePath: string;
  startLine: number;
  endLine: number;
  name: string;
  why: string;
}

export type DowngradeReason = 'NO_VALID_CITATION' | 'NO_PROPOSAL';

export interface DroppedCitation {
  chunkId: string;
  reason: 'NOT_IN_CANDIDATES';
}

export interface ApplicabilityJudgement {
  verdict: ApplicabilityVerdict;
  rawVerdict: ApplicabilityVerdict | null;
  reason: string;
  citations: ApplicabilityCitation[];
  droppedCitations: DroppedCitation[];
  downgradeReason: DowngradeReason | null;
  proposal: ApplicabilityProposal | null;
  candidateCount: number;
}
