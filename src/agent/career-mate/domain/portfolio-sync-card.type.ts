import { PortfolioSiteSkillGroupPayload } from './portfolio-site-payload';

export interface PortfolioSyncPlanCard {
  slug: string;
  repo: string;
  topicIndex: number;
  anonymized: boolean;
  siteProjectId: string | null;
  siteBaseline: { id: string; sortOrder: number; links: unknown } | null;
  action: 'create' | 'update';
  memberPrs: string[];
  coverHash: string;
  regenerate: boolean;
  coverPassed: boolean;
  coverWasPublic: boolean;
  sortOrderSent: number | null;
  sortOrderOwned: number | null;
  body: Record<string, unknown>;
}

export interface PortfolioSyncAdoptionRow {
  slug: string;
  siteProjectId: string | null;
  repo: string;
  topicIndex: number;
  memberPrs: string[];
  coverOf: string | null;
}

export interface PortfolioSyncPlan {
  version: 1;
  createdAt: string;
  baseFingerprint: string;
  agentRunId: number;
  adoption: {
    rows: PortfolioSyncAdoptionRow[];
    table: { slug: string; siteProjectId: string; title: string }[];
    mismatch?: { onlyInPlan: string[]; onlyOnSite: string[] };
  } | null;
  cards: PortfolioSyncPlanCard[];
  skillGroups: PortfolioSiteSkillGroupPayload[];
  report: {
    skippedTitles: string[];
    unnamedKeys: string[];
    planViolations: string[];
    notInPlan: string[];
    unknownTechTerms: string[];
    ambiguousAssignments: string[];
    coverRetry: string[];
    sortOrderKeptByHuman: string[];
  };
}
