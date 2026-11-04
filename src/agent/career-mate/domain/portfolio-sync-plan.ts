import { createHash } from 'node:crypto';

import { ProfileAccomplishment } from './career-mate.type';
import { PortfolioSyncCardRow } from './port/portfolio-sync-card.repository.port';
import { maskRepoTokens, sanitizeMergedAt } from './portfolio-site-payload';
import { ProjectGroup } from './project-group';
import { toPrNumber } from './reconcile-accomplishment-evidence';

export const COVER_SPEC_VERSION = 'cover-v1';

export interface CardAssignmentCandidate {
  slug: string;
  topicIndex: number;
  memberPrs: string[];
}

export interface CardAssignment {
  card: CardAssignmentCandidate;
  ambiguous: boolean;
}

export const assignToCard = (
  accomplishmentPrs: string[],
  cards: CardAssignmentCandidate[],
): CardAssignment | null => {
  if (cards.length === 0) {
    return null;
  }
  if (cards.length === 1) {
    return { card: cards[0], ambiguous: false };
  }
  const source = new Set(accomplishmentPrs);
  const ranked = cards
    .map((card) => ({
      card,
      overlap: card.memberPrs.filter((member) => source.has(member)).length,
    }))
    .sort(
      (left, right) =>
        right.overlap - left.overlap ||
        left.card.topicIndex - right.card.topicIndex ||
        left.card.slug.localeCompare(right.card.slug),
    );
  return {
    card: ranked[0].card,
    ambiguous: ranked[0].overlap === ranked[1].overlap,
  };
};

export const buildMemberPrs = (
  accomplishments: ProfileAccomplishment[],
): string[] =>
  [
    ...new Set(
      accomplishments.flatMap((accomplishment) =>
        accomplishment.evidence.map(
          ({ repo, pr }) => `${repo.trim().toLowerCase()}#${toPrNumber(pr)}`,
        ),
      ),
    ),
  ].sort();

export const computeCoverHash = (memberPrs: string[]): string =>
  createHash('sha1')
    .update(`${memberPrs.join('\n')}\n${COVER_SPEC_VERSION}`)
    .digest('hex');

export const shouldRegenerateCover = (
  row: { coverOf: string | null } | null,
  coverHash: string,
): boolean => row === null || row.coverOf !== coverHash;

export const buildProcessLines = (group: ProjectGroup): string[] => {
  const ranked = group.accomplishments
    .map((accomplishment) => ({
      accomplishment,
      latestMergedAt: Math.max(
        ...accomplishment.evidence.map((evidence) => {
          const valid = sanitizeMergedAt(evidence.mergedAt);
          return valid === null ? -Infinity : new Date(valid).getTime();
        }),
      ),
      greatestPr: Math.max(
        ...accomplishment.evidence.map((evidence) => toPrNumber(evidence.pr)),
      ),
    }))
    .sort(
      (left, right) =>
        right.latestMergedAt - left.latestMergedAt ||
        right.greatestPr - left.greatestPr ||
        left.accomplishment.title
          .trim()
          .localeCompare(right.accomplishment.title.trim()),
    );
  const titles = new Set<string>();
  const process: string[] = [];
  for (const { accomplishment } of ranked) {
    const title = accomplishment.title.trim();
    if (titles.has(title)) {
      continue;
    }
    titles.add(title);
    const bullet = accomplishment.bullet.trim();
    if (!bullet) {
      continue;
    }
    process.push(
      group.anonymized ? maskRepoTokens(bullet, group.repo) : bullet,
    );
    if (process.length === 10) {
      break;
    }
  }
  return process;
};

export const baseFingerprint = (rows: PortfolioSyncCardRow[]): string => {
  if (rows.length === 0) {
    return 'empty';
  }
  const serialized = [...rows]
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .map((row) =>
      [row.slug, row.status, row.coverOf ?? '', row.memberPrs.join(',')].join(
        '|',
      ),
    )
    .join('\n');
  return createHash('sha1').update(serialized).digest('hex');
};

export interface SiteProjectForAdoption {
  id: string;
  slug: string;
  title: string;
}

export interface CardForAdoption {
  slug: string;
  repo: string;
}

export interface AdoptionPlan {
  rows: {
    slug: string;
    siteProjectId: string;
    repo: string;
    topicIndex: number;
    memberPrs: string[];
    coverOf: null;
  }[];
  table: { slug: string; siteProjectId: string; title: string }[];
  mismatch?: { onlyInPlan: string[]; onlyOnSite: string[] };
}

export const planAdoption = (
  cards: CardForAdoption[],
  siteProjects: SiteProjectForAdoption[],
): AdoptionPlan => {
  const siteBySlug = new Map(
    siteProjects.map((project) => [project.slug, project]),
  );
  const plannedSlugs = new Set(cards.map((card) => card.slug));
  const onlyInPlan = cards
    .map((card) => card.slug)
    .filter((slug) => !siteBySlug.has(slug))
    .sort();
  const onlyOnSite = siteProjects
    .map((project) => project.slug)
    .filter((slug) => !plannedSlugs.has(slug))
    .sort();
  if (onlyInPlan.length > 0 || onlyOnSite.length > 0) {
    return { rows: [], table: [], mismatch: { onlyInPlan, onlyOnSite } };
  }
  return {
    rows: cards.map((card) => ({
      slug: card.slug,
      siteProjectId: (siteBySlug.get(card.slug) as SiteProjectForAdoption).id,
      repo: card.repo.trim().toLowerCase(),
      topicIndex: 1,
      memberPrs: [],
      coverOf: null,
    })),
    table: cards.map((card) => {
      const project = siteBySlug.get(card.slug) as SiteProjectForAdoption;
      return {
        slug: card.slug,
        siteProjectId: project.id,
        title: project.title,
      };
    }),
  };
};

export const mergeGithubLink = ({
  links,
  repo,
  anonymized,
  isPublic,
}: {
  links: Record<string, unknown>;
  repo: string;
  anonymized: boolean;
  isPublic: boolean;
}): Record<string, unknown> => {
  const merged = { ...links };
  if (anonymized || !isPublic) {
    delete merged.github;
  } else {
    merged.github = `https://github.com/${repo.trim()}`;
  }
  return merged;
};

export interface SortOrderDecision {
  sortOrderSent: number | null;
  keptByHuman: boolean;
}

export const decideSortOrder = ({
  action,
  target,
  current,
  lastSent,
}: {
  action: 'create' | 'update';
  target: number;
  current: number;
  lastSent: number | null;
}): SortOrderDecision => {
  if (action === 'create') {
    return { sortOrderSent: target, keptByHuman: false };
  }
  if (lastSent !== null && lastSent !== current) {
    return { sortOrderSent: null, keptByHuman: true };
  }
  return {
    sortOrderSent: target === current ? null : target,
    keptByHuman: false,
  };
};
