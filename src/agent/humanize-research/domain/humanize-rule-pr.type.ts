import { ProposalTarget } from './humanize-research.type';

export const CANON_REPO = 'JSL107/humanize-korean';
export const BLOG_REPO = 'JSL107/personal_agents';
export const RULE_LINKS_FILE = 'src/humanize/domain/humanize-rule-links.ts';

export interface HumanizeRulePrPayload {
  target: ProposalTarget;
  repo: string;
  baseBranch: string;
  baseSha: string | null;
  file: string;
  oldString: string;
  newString: string;
  rationale: string;
  targetMetric: string;
  evidence: string[];
  evidenceExcerpts: string[];
  linkedBlogText: string | null;
}

export const isHumanizeRulePrPayload = (
  value: unknown,
): value is HumanizeRulePrPayload => {
  const arrayValue = Array.isArray(value);
  if (typeof value !== 'object' || value === null || arrayValue) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const validTarget =
    candidate.target === ProposalTarget.CANON ||
    candidate.target === ProposalTarget.BLOG;
  const evidence = candidate.evidence;
  const excerpts = candidate.evidenceExcerpts;
  const evidenceArray = Array.isArray(evidence);
  const excerptsArray = Array.isArray(excerpts);
  if (!evidenceArray || !excerptsArray) {
    return false;
  }
  const validEvidence = evidence.every((item) => typeof item === 'string');
  const validExcerpts = excerpts.every((item) => typeof item === 'string');
  const valid =
    validTarget &&
    typeof candidate.repo === 'string' &&
    typeof candidate.baseBranch === 'string' &&
    (candidate.baseSha === null || typeof candidate.baseSha === 'string') &&
    typeof candidate.file === 'string' &&
    typeof candidate.oldString === 'string' &&
    typeof candidate.newString === 'string' &&
    typeof candidate.rationale === 'string' &&
    typeof candidate.targetMetric === 'string' &&
    validEvidence &&
    validExcerpts &&
    (candidate.linkedBlogText === null ||
      typeof candidate.linkedBlogText === 'string');
  return valid;
};
