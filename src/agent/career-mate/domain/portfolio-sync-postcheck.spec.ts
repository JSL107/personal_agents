import { PortfolioSiteProject } from './port/portfolio-site.client.port';
import { PortfolioSyncCardRow } from './port/portfolio-sync-card.repository.port';
import { PortfolioSyncPlanCard } from './portfolio-sync-card.type';
import { postCheckPortfolioSync } from './portfolio-sync-postcheck';

const project = (
  slug: string,
  data: Record<string, unknown>,
): PortfolioSiteProject => ({
  id: slug,
  slug,
  published: false,
  sortOrder: 1,
  data: {
    title: '카드',
    summary: '소개',
    problem: '문제',
    result: '승인율 3%에서 0%로 개선',
    process: ['승인율 3%에서 0%로 개선'],
    keyContributions: ['승인율 3%에서 0%로 개선'],
    techStack: ['TypeScript', 'NestJS'],
    links: { github: `https://github.com/example/${slug}` },
    ...data,
  },
});

const row = (slug: string, repo = 'example/repo'): PortfolioSyncCardRow => ({
  slug,
  siteProjectId: slug,
  repo,
  topicIndex: 1,
  memberPrs: [],
  coverOf: null,
  status: 'ACTIVE',
  inheritPublished: false,
  lastSentSortOrder: null,
});

const card = (
  slug: string,
  anonymized = false,
  body: Record<string, unknown> = {},
): PortfolioSyncPlanCard => ({
  slug,
  repo: 'example/repo',
  topicIndex: 1,
  anonymized,
  siteProjectId: slug,
  siteBaseline: null,
  action: 'update',
  memberPrs: [],
  coverHash: '',
  regenerate: false,
  coverPassed: false,
  coverWasPublic: false,
  sortOrderSent: null,
  body,
});

const check = (
  projects: PortfolioSiteProject[],
  options: {
    before?: PortfolioSiteProject[];
    cards?: PortfolioSyncPlanCard[];
    rows?: PortfolioSyncCardRow[];
    planViolations?: string[];
  } = {},
) =>
  postCheckPortfolioSync({
    projects,
    before: options.before ?? projects,
    cards: options.cards ?? projects.map((item) => card(item.slug)),
    rows: options.rows ?? projects.map((item) => row(item.slug)),
    planViolations: options.planViolations ?? [],
  });

describe('portfolio sync 사후 검사', () => {
  it('숫자 토큰이 과정에 없는 표지를 규칙 1로 보고한다', () => {
    expect(
      check([project('a', { keyContributions: ['승인율 18% 개선'] })]).map(
        (item) => item.rule,
      ),
    ).toContain(1);
  });

  it('과정이 10줄을 넘거나 한 저장소의 카드가 3장을 넘으면 규칙 2로 보고한다', () => {
    const projects = ['a', 'b', 'c', 'd'].map((slug) => project(slug, {}));
    projects[0].data.process = Array(11).fill('승인율 3%에서 0%로 개선');
    const violations = check(projects);
    expect(
      violations.filter((item) => item.rule === 2).map((item) => item.slug),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('기술 중복·금지어와 테스트 통과 수를 규칙 3·4로 보고한다', () => {
    const violations = check([
      project('a', {
        techStack: ['TypeScript', 'typescript', 'JSON'],
        keyContributions: ['테스트 3개 통과'],
      }),
    ]);
    expect(violations.map((item) => item.rule)).toEqual(
      expect.arrayContaining([3, 4]),
    );
  });

  it('계획 위반을 규칙 5로 옮기고 표지 미전송 카드의 편집을 규칙 6으로 보고한다', () => {
    const before = project('a', {});
    const after = project('a', { title: '바뀜' });
    const violations = check([after], {
      before: [before],
      planViolations: ['PR 중복'],
    });
    expect(violations.map((item) => item.rule)).toEqual(
      expect.arrayContaining([5, 6]),
    );
  });

  it('익명 링크와 마스킹 뒤 식별 토큰을 규칙 7·8로 보고한다', () => {
    const violations = check(
      [project('a', { title: '사내 저장소-backendconfig 개선' })],
      {
        cards: [card('a', true)],
      },
    );
    expect(violations.map((item) => item.rule)).toEqual(
      expect.arrayContaining([7, 8]),
    );
  });

  it('계획 대상 밖 프로젝트는 검사하지 않는다', () => {
    const violations = check(
      [project('foreign', { process: Array(11).fill('사내 저장소-비밀') })],
      {
        cards: [],
        rows: [],
      },
    );
    expect(violations).toEqual([]);
  });
});
