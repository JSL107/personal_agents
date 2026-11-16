import { P } from 'ts-pattern';

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

export const HUMANIZE_RULE_PR_PAYLOAD_PATTERN = {
  target: P.union(ProposalTarget.CANON, ProposalTarget.BLOG),
  repo: P.string,
  baseBranch: P.string,
  baseSha: P.union(P.string, null),
  file: P.string,
  oldString: P.string,
  newString: P.string,
  rationale: P.string,
  targetMetric: P.string,
  evidence: P.array(P.string),
  evidenceExcerpts: P.array(P.string),
  linkedBlogText: P.union(P.string, null),
};
