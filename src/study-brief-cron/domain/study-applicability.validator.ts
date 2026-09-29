import { KeywordCandidate } from '../../code-graph/domain/keyword-candidate.type';
import {
  APPLICABILITY_VERDICT,
  ApplicabilityCitation,
  ApplicabilityJudgement,
  DowngradeReason,
  DroppedCitation,
  RawApplicabilityOutput,
} from './study-applicability.type';

export const validateApplicability = (
  raw: RawApplicabilityOutput,
  candidates: readonly KeywordCandidate[],
): ApplicabilityJudgement => {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const citations: ApplicabilityCitation[] = [];
  const droppedCitations: DroppedCitation[] = [];
  for (const citation of raw.citations) {
    const found = byId.get(citation.chunkId);
    if (!found) {
      droppedCitations.push({
        chunkId: citation.chunkId,
        reason: 'NOT_IN_CANDIDATES',
      });
      continue;
    }
    citations.push({
      filePath: found.filePath,
      startLine: found.startLine,
      endLine: found.endLine,
      name: found.name,
      why: citation.why,
    });
  }

  const downgradeReason = resolveDowngrade(raw, citations.length);
  const verdict =
    downgradeReason === null ? raw.verdict : APPLICABILITY_VERDICT.REFERENCE;
  return {
    verdict,
    rawVerdict: raw.verdict,
    reason: raw.reason,
    citations,
    droppedCitations,
    downgradeReason,
    proposal: verdict === APPLICABILITY_VERDICT.APPLY ? raw.proposal : null,
    candidateCount: candidates.length,
  };
};

const resolveDowngrade = (
  raw: RawApplicabilityOutput,
  validCitationCount: number,
): DowngradeReason | null => {
  if (raw.verdict !== APPLICABILITY_VERDICT.APPLY) {
    return null;
  }
  if (validCitationCount === 0) {
    return 'NO_VALID_CITATION';
  }
  if (raw.proposal === null) {
    return 'NO_PROPOSAL';
  }
  return null;
};

export const notApplicableWithoutModel = (
  reason: string,
  candidateCount: number,
): ApplicabilityJudgement => ({
  verdict: APPLICABILITY_VERDICT.NOT_APPLICABLE,
  rawVerdict: null,
  reason,
  citations: [],
  droppedCitations: [],
  downgradeReason: null,
  proposal: null,
  candidateCount,
});
