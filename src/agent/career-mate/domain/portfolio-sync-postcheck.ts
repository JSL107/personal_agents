import { PortfolioSiteProject } from './port/portfolio-site.client.port';
import { PortfolioSyncCardRow } from './port/portfolio-sync-card.repository.port';
import {
  hasUngroundedNumbers,
  isTestPassCount,
} from './portfolio-cover.validate';
import { PortfolioSyncPlanCard } from './portfolio-sync-card.type';
import { normalizeTechStack } from './tech-stack.normalize';

export interface PortfolioSyncPostCheckViolation {
  slug: string;
  rule: number;
  detail: string;
}

export interface PortfolioSyncPostCheckInput {
  projects: PortfolioSiteProject[];
  before: PortfolioSiteProject[];
  cards: PortfolioSyncPlanCard[];
  rows: PortfolioSyncCardRow[];
  planViolations: string[];
}

const stringArray = (value: unknown): string[] | null => {
  const isStringArray =
    Array.isArray(value) && value.every((item) => typeof item === 'string');
  const strings = isStringArray ? value : null;
  return strings;
};

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const COVER_FIELDS = [
  'title',
  'summary',
  'problem',
  'result',
  'keyContributions',
];
const PUBLIC_TEXT_FIELDS = [
  'title',
  'summary',
  'problem',
  'result',
  'process',
  'keyContributions',
];
const LEAKED_REPO_PATTERN = /사내 저장소[\w.-]/;
const GITHUB_REPOSITORY_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;
const PROCESS_MAX_COUNT = 10;
const CARDS_PER_REPO_MAX_COUNT = 3;
const TECH_STACK_MAX_COUNT = 12;

// 재조회 결과만 검사한다. 사이트가 실제 저장한 값이 계획 본문과 다를 수 있기 때문이다.
export const postCheckPortfolioSync = ({
  projects,
  before,
  cards,
  rows,
  planViolations,
}: PortfolioSyncPostCheckInput): PortfolioSyncPostCheckViolation[] => {
  const violations: PortfolioSyncPostCheckViolation[] = [];
  const cardBySlug = new Map(cards.map((card) => [card.slug, card]));
  const beforeBySlug = new Map(
    before.map((project) => [project.slug, project]),
  );
  const repoBySlug = new Map(rows.map((row) => [row.slug, row.repo]));
  for (const card of cards) {
    repoBySlug.set(card.slug, card.repo);
  }
  const repoCount = new Map<string, number>();
  for (const repo of repoBySlug.values()) {
    const key = repo.trim().toLowerCase();
    repoCount.set(key, (repoCount.get(key) ?? 0) + 1);
  }

  for (const project of projects) {
    if (!repoBySlug.has(project.slug)) {
      continue;
    }
    const data = project.data;
    const process = stringArray(data.process);
    const highlights =
      data.keyContributions === undefined
        ? []
        : stringArray(data.keyContributions);
    const techStack = stringArray(data.techStack);
    const result = stringValue(data.result);
    const hasInvalidCoverNumbers =
      process === null ||
      highlights === null ||
      hasUngroundedNumbers({ text: result, processLines: process }) ||
      highlights.some((line) =>
        hasUngroundedNumbers({ text: line, processLines: process }),
      );
    if (hasInvalidCoverNumbers) {
      violations.push({
        slug: project.slug,
        rule: 1,
        detail: '표지의 숫자가 과정 10줄에 없다',
      });
    }
    const repo = repoBySlug.get(project.slug) as string;
    const repoKey = repo.trim().toLowerCase();
    const cardCount = repoCount.get(repoKey) ?? 0;
    const exceedsProcessOrCardLimit =
      process === null ||
      process.length > PROCESS_MAX_COUNT ||
      cardCount > CARDS_PER_REPO_MAX_COUNT;
    if (exceedsProcessOrCardLimit) {
      violations.push({
        slug: project.slug,
        rule: 2,
        detail: '과정 또는 저장소당 카드 수 상한을 넘었다',
      });
    }
    const hasInvalidTechStack =
      techStack === null ||
      techStack.length > TECH_STACK_MAX_COUNT ||
      normalizeTechStack([techStack]).techStack.length !== techStack.length;
    if (hasInvalidTechStack) {
      violations.push({
        slug: project.slug,
        rule: 3,
        detail: '기술 스택 상한·중복·금지어 또는 표준 표기가 어긋났다',
      });
    }
    const hasTestCountHighlight =
      highlights === null || highlights.some(isTestPassCount);
    if (hasTestCountHighlight) {
      violations.push({
        slug: project.slug,
        rule: 4,
        detail: '테스트 통과 수가 대표 성과에 있다',
      });
    }
    const card = cardBySlug.get(project.slug);
    const previous = beforeBySlug.get(project.slug);
    const coverWasNotSent =
      card && previous && !COVER_FIELDS.some((field) => field in card.body);
    if (coverWasNotSent) {
      const coverChanged = COVER_FIELDS.some(
        (field) =>
          JSON.stringify(data[field]) !== JSON.stringify(previous.data[field]),
      );
      if (coverChanged) {
        violations.push({
          slug: project.slug,
          rule: 6,
          detail: '이번 회차에 표지를 보내지 않았는데 표지가 바뀌었다',
        });
      }
    }
    const links = data.links;
    const github =
      links && typeof links === 'object' && !Array.isArray(links)
        ? (links as Record<string, unknown>).github
        : undefined;
    const invalidGithubLink =
      (card?.anonymized && github !== undefined) ||
      (github !== undefined &&
        (typeof github !== 'string' ||
          !GITHUB_REPOSITORY_PATTERN.test(github)));
    if (invalidGithubLink) {
      violations.push({
        slug: project.slug,
        rule: 7,
        detail: 'github 링크가 익명 또는 저장소 루트 정책을 어겼다',
      });
    }
    const publicText = PUBLIC_TEXT_FIELDS.flatMap((field) => {
      const value = data[field];
      const lines = Array.isArray(value)
        ? value.map(String)
        : [String(value ?? '')];
      return lines;
    });
    const hasLeakedRepoToken = publicText.some((line) =>
      LEAKED_REPO_PATTERN.test(line),
    );
    if (hasLeakedRepoToken) {
      violations.push({
        slug: project.slug,
        rule: 8,
        detail: '익명 저장소 마스킹 뒤에 식별 토큰이 남았다',
      });
    }
  }
  for (const detail of planViolations) {
    violations.push({ slug: '*', rule: 5, detail });
  }
  return violations;
};
