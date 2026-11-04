import { ConfigService } from '@nestjs/config';

import { CronIdempotencyService } from '../../../common/queue/cron-idempotency.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CareerProfileData } from '../domain/career-mate.type';
import { CareerProfileRepositoryPort } from '../domain/port/career-profile.repository.port';
import {
  PortfolioSiteClientPort,
  PortfolioSiteProject,
  PortfolioSiteSkillGroup,
} from '../domain/port/portfolio-site.client.port';
import {
  PortfolioSyncCardRepositoryPort,
  PortfolioSyncCardRow,
} from '../domain/port/portfolio-sync-card.repository.port';
import { PublishPortfolioSiteUsecase } from './publish-portfolio-site.usecase';

const SLUG = 'jsl107-personal-agents';
const REPO = 'JSL107/personal_agents';
const PROFILE: CareerProfileData = {
  summary: '백엔드 개발자',
  skills: [],
  accomplishments: [
    {
      title: '백테스트 재생 루프',
      bullet: '실패 3회를 0회로 줄였다',
      star: { situation: '문제', task: '과제', action: '행동', result: '결과' },
      techTags: ['TypeScript', 'NestJS'],
      evidence: [
        {
          repo: REPO,
          pr: 313,
          url: `https://github.com/${REPO}/pull/313`,
          mergedAt: '2026-08-14T01:00:00Z',
        },
      ],
    },
  ],
  meta: { githubLogin: 'JSL107', windowStart: '2026-06-01', prCount: 3 },
};
const site = (
  overrides: Partial<PortfolioSiteProject> = {},
): PortfolioSiteProject => ({
  id: 'p1',
  slug: SLUG,
  published: true,
  sortOrder: 1,
  data: {
    slug: SLUG,
    title: '이전 제목',
    summary: '이전 요약',
    problem: '이전 문제',
    result: '실패 3회를 0회로 줄였다',
    keyContributions: ['실패 3회 → 0회'],
    process: ['실패 3회를 0회로 줄였다'],
    techStack: ['TypeScript', 'NestJS'],
    period: '2026.08',
    links: {},
  },
  ...overrides,
});
const row = (
  overrides: Partial<PortfolioSyncCardRow> = {},
): PortfolioSyncCardRow => ({
  slug: SLUG,
  siteProjectId: 'p1',
  repo: REPO.toLowerCase(),
  topicIndex: 1,
  memberPrs: [`${REPO.toLowerCase()}#313`],
  coverOf: null,
  status: 'ACTIVE',
  inheritPublished: false,
  lastSentSortOrder: 1,
  ...overrides,
});
interface FixtureOptions {
  rows?: PortfolioSyncCardRow[];
  sites?: PortfolioSiteProject[];
  profile?: CareerProfileData;
  anonymizedOwners?: string;
  modelOutput?: (keys: string[]) => string;
}
const createFixture = (options: FixtureOptions = {}) => {
  const rows = [...(options.rows ?? [row()])];
  const sites = [...(options.sites ?? [site()])];
  const repository: PortfolioSyncCardRepositoryPort = {
    findAll: jest.fn(async () => rows.map((item) => ({ ...item }))),
    upsertActive: jest.fn(async (input) => {
      const index = rows.findIndex((item) => item.slug === input.slug);
      const next: PortfolioSyncCardRow = {
        ...row(),
        ...rows[index],
        ...input,
        status: 'ACTIVE',
        inheritPublished: rows[index]?.inheritPublished ?? false,
        lastSentSortOrder:
          input.lastSentSortOrder ?? rows[index]?.lastSentSortOrder ?? null,
      };
      if (index < 0) {
        rows.push(next);
      } else {
        rows[index] = next;
      }
    }),
    clearCoverOf: jest.fn(async (slugs) => {
      for (const item of rows) {
        if (slugs.includes(item.slug)) {
          item.coverOf = null;
        }
      }
    }),
    createMany: jest.fn(async (items) => {
      for (const item of items) {
        rows.push({
          ...item,
          status: 'ACTIVE',
          inheritPublished: false,
          lastSentSortOrder: null,
        });
      }
    }),
  };
  const skillGroups: PortfolioSiteSkillGroup[] = [];
  const client: PortfolioSiteClientPort = {
    listProjects: jest.fn(async () =>
      sites.map((item) => ({ ...item, data: { ...item.data } })),
    ),
    createProject: jest.fn(async (data) => {
      if (sites.some((item) => item.slug === data.slug)) {
        throw new Error('HTTP 409');
      }
      const next: PortfolioSiteProject = {
        id: `p${sites.length + 1}`,
        slug: String(data.slug),
        published: data.published === true,
        sortOrder: Number(data.sortOrder ?? 0),
        data: { ...data },
      };
      sites.push(next);
      return next;
    }),
    updateProject: jest.fn(async (id, data) => {
      const found = sites.find((item) => item.id === id);
      if (!found) {
        throw new Error('HTTP 404');
      }
      found.data = { ...found.data, ...data };
      if ('sortOrder' in data) {
        found.sortOrder = Number(data.sortOrder);
      }
      return { ...found, data: { ...found.data } };
    }),
    listSkillGroups: jest.fn(async () => skillGroups),
    createSkillGroup: jest.fn(async (data) => {
      const next = { id: 'g1', sortOrder: 1, data };
      skillGroups.push(next);
      return next;
    }),
    updateSkillGroup: jest.fn(async (id, data) => ({ id, sortOrder: 1, data })),
  };
  const modelRouter = {
    route: jest.fn(async ({ request }: { request: { prompt: string } }) => {
      const keys = [...request.prompt.matchAll(/^key: (.+)$/gm)].map(
        (match) => match[1],
      );
      return {
        text:
          options.modelOutput?.(keys) ??
          JSON.stringify({
            projects: keys.map((key) => ({
              key,
              title: '새 제목',
              summary: '새 요약',
              problem: '새 문제',
              result: '실패 3회를 0회로 줄였다',
              highlights: ['실패 3회 → 0회'],
            })),
          }),
      };
    }),
  } as unknown as ModelRouterUsecase;
  const profileRepository = {
    findLatestBySlackUser: jest.fn(async () => ({
      id: 1,
      profileJson: options.profile ?? PROFILE,
      agentRunId: 77,
      createdAt: new Date(),
    })),
  } as unknown as CareerProfileRepositoryPort;
  const github = {
    isRepositoryPublic: jest.fn(async () => false),
  } as unknown as GithubClientPort;
  const lock = new CronIdempotencyService();
  const usecase = new PublishPortfolioSiteUsecase(
    profileRepository,
    client,
    {
      get: (key: string) =>
        key === 'PORTFOLIO_ANONYMIZED_OWNERS'
          ? options.anonymizedOwners
          : undefined,
    } as unknown as ConfigService,
    modelRouter,
    repository,
    github,
    lock,
  );
  return {
    usecase,
    rows,
    sites,
    client,
    repository,
    modelRouter,
    github,
    lock,
  };
};

describe('PublishPortfolioSiteUsecase 계획과 적용', () => {
  it('채택 목록이 사이트와 정확히 맞으면 apply 때만 DB 행을 만든다', async () => {
    const fixture = createFixture({ rows: [] });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    expect(plan.adoption?.mismatch).toBeUndefined();
    expect(fixture.repository.createMany).not.toHaveBeenCalled();
    await fixture.usecase.apply({ plan });
    expect(fixture.repository.createMany).toHaveBeenCalledTimes(1);
    expect(fixture.rows).toHaveLength(1);
  });

  it('채택 목록이 사이트와 다르면 적용 전에 중단한다', async () => {
    const fixture = createFixture({ rows: [], sites: [] });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    expect(plan.adoption?.mismatch?.onlyInPlan).toEqual([SLUG]);
    const result = await fixture.usecase.apply({ plan });
    expect(result.aborted).toBeTruthy();
    expect(fixture.repository.createMany).not.toHaveBeenCalled();
    expect(fixture.client.createProject).not.toHaveBeenCalled();
  });

  it('plan은 DB와 사이트에 쓰지 않는다', async () => {
    const fixture = createFixture();
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    expect(plan.cards).toHaveLength(1);
    expect(fixture.repository.upsertActive).not.toHaveBeenCalled();
    expect(fixture.client.updateProject).not.toHaveBeenCalled();
  });
  it('빈 테이블의 execute는 채택을 요구하고 쓰지 않는다', async () => {
    const fixture = createFixture({ rows: [] });
    const result = await fixture.usecase.execute({ slackUserId: 'U1' });
    expect(result.adoptionRequired).toBe(true);
    expect(fixture.client.updateProject).not.toHaveBeenCalled();
    expect(fixture.repository.createMany).not.toHaveBeenCalled();
  });
  it('계획 뒤 DB가 바뀌면 fingerprint 불일치로 쓰지 않는다', async () => {
    const fixture = createFixture();
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    fixture.rows[0].coverOf = 'changed';
    const result = await fixture.usecase.apply({ plan });
    expect(result.aborted).toMatch(/싱크 상태가 바뀌었습니다/);
    expect(fixture.client.updateProject).not.toHaveBeenCalled();
    expect(fixture.repository.upsertActive).not.toHaveBeenCalled();
  });
  it('계획 뒤 사이트 링크가 바뀌면 적용 전에 중단한다', async () => {
    const previous = site({
      data: {
        ...site().data,
        links: { github: 'https://github.com/old/repo' },
      },
    });
    const fixture = createFixture({ sites: [previous] });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    fixture.sites[0].data.links = { github: 'https://github.com/human/edited' };
    const result = await fixture.usecase.apply({ plan });
    expect(result.aborted).toMatch(/사이트 카드가 바뀌었습니다/);
    expect(fixture.client.updateProject).not.toHaveBeenCalled();
  });
  it('계획 뒤 사이트 순서가 바뀌면 적용 전에 중단한다', async () => {
    const fixture = createFixture({
      rows: [row({ lastSentSortOrder: null })],
      sites: [site({ sortOrder: 7 })],
    });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    expect(plan.cards[0].body.sortOrder).toBe(1);
    fixture.sites[0].sortOrder = 9;
    const result = await fixture.usecase.apply({ plan });
    expect(result.aborted).toMatch(/사이트 카드가 바뀌었습니다/);
    expect(fixture.client.updateProject).not.toHaveBeenCalled();
  });
  it('같은 입력의 두 번째 회차는 모델과 표지 쓰기를 건너뛴다', async () => {
    const fixture = createFixture();
    await fixture.usecase.execute({ slackUserId: 'U1' });
    const firstCalls = (fixture.modelRouter.route as jest.Mock).mock.calls
      .length;
    (fixture.client.updateProject as jest.Mock).mockClear();
    await fixture.usecase.execute({ slackUserId: 'U1' });
    expect((fixture.modelRouter.route as jest.Mock).mock.calls).toHaveLength(
      firstCalls,
    );
    const [, body] = (fixture.client.updateProject as jest.Mock).mock.calls[0];
    for (const key of [
      'title',
      'summary',
      'problem',
      'result',
      'keyContributions',
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });
  it('구성이 같아도 사이트에서 사라진 카드는 표지를 다시 지어 생성한다', async () => {
    const fixture = createFixture();
    await fixture.usecase.execute({ slackUserId: 'U1' });
    fixture.sites.splice(0, fixture.sites.length);
    const result = await fixture.usecase.execute({ slackUserId: 'U1' });
    expect(result.createdProjects).toEqual([SLUG]);
    expect(fixture.client.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ slug: SLUG, title: '새 제목' }),
    );
  });
  it('성과 줄이 전부 빠지면 줄마다 제외 사유를 실어 한 번 더 요청한다', async () => {
    const fixture = createFixture({
      modelOutput: (keys) =>
        JSON.stringify({
          projects: keys.map((key) => ({
            key,
            title: '새 제목',
            summary: '새 요약',
            problem: '새 문제',
            result: '실패 3회를 0회로 줄였다',
            highlights: ['실패 30회 → 0회'],
          })),
        }),
    });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    const calls = (fixture.modelRouter.route as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0].request.prompt).toContain(
      `- ${SLUG}: "실패 30회 → 0회" — 과정 10줄에 없는 숫자`,
    );
    expect(plan.report.coverRetry).toEqual([SLUG]);
  });
  it('update 본문에는 published·featured·싱크 메타가 없다', async () => {
    const plan = await createFixture().usecase.plan({ slackUserId: 'U1' });
    for (const key of [
      'published',
      'featured',
      'coverOf',
      'memberPrs',
      'coverHash',
      'siteProjectId',
    ]) {
      expect(plan.cards[0].body).not.toHaveProperty(key);
    }
  });
  it('모델이 카드를 빠뜨리면 표지를 보내지 않고 coverOf를 유지한다', async () => {
    const fixture = createFixture({
      modelOutput: () => JSON.stringify({ projects: [] }),
    });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    expect(plan.cards[0].coverPassed).toBe(false);
    expect(plan.cards[0].body).not.toHaveProperty('title');
    await fixture.usecase.apply({ plan });
    expect(fixture.rows[0].coverOf).toBeNull();
  });
  it('모델 파손과 기존 숫자 위반 시 위반 필드만 비운다', async () => {
    const prior = site({
      data: {
        ...site().data,
        result: '근거 없는 99회',
        keyContributions: ['근거 없는 99회'],
      },
    });
    const fixture = createFixture({
      sites: [prior],
      modelOutput: () => '파손된 JSON',
    });
    const plan = await fixture.usecase.plan({ slackUserId: 'U1' });
    expect(plan.cards[0].body).toMatchObject({
      result: '',
      keyContributions: [],
    });
    expect(plan.cards[0].body).not.toHaveProperty('title');
  });
  it('잠금 선점 시 실행을 거절하고 쓰지 않는다', async () => {
    const fixture = createFixture();
    await fixture.lock.acquireOnce('portfolio-publish:lock', 900);
    await expect(
      fixture.usecase.execute({ slackUserId: 'U1' }),
    ).rejects.toThrow(/이미 실행 중/);
    expect(fixture.client.updateProject).not.toHaveBeenCalled();
    await fixture.lock.release('portfolio-publish:lock');
  });
  it('사람이 바꾼 sortOrder는 보존한다', async () => {
    const plan = await createFixture({
      sites: [site({ sortOrder: 7 })],
    }).usecase.plan({ slackUserId: 'U1' });
    expect(plan.cards[0].body).not.toHaveProperty('sortOrder');
    expect(plan.report.sortOrderKeptByHuman).toEqual([SLUG]);
  });
  it('기존 links의 video·docs는 보존하며 github만 제거한다', async () => {
    const previous = site({
      data: {
        ...site().data,
        links: {
          video: 'https://video.test',
          docs: 'https://docs.test',
          github: 'https://github.com/old/repo',
        },
      },
    });
    const plan = await createFixture({ sites: [previous] }).usecase.plan({
      slackUserId: 'U1',
    });
    expect(plan.cards[0].body.links).toEqual({
      video: 'https://video.test',
      docs: 'https://docs.test',
    });
  });

  it('프로필의 bullet만 바뀌고 PR 집합이 같으면 표지를 다시 만들지 않는다', async () => {
    const fixture = createFixture();
    await fixture.usecase.execute({ slackUserId: 'U1' });
    const calls = (fixture.modelRouter.route as jest.Mock).mock.calls.length;
    const previous = fixture.sites[0].data;
    const updatedProfile: CareerProfileData = {
      ...PROFILE,
      accomplishments: [
        {
          ...PROFILE.accomplishments[0],
          bullet: '사망 3회를 0회로 줄인 운영 재구성',
        },
      ],
    };
    const second = createFixture({
      rows: fixture.rows,
      sites: fixture.sites,
      profile: updatedProfile,
    });
    await second.usecase.execute({ slackUserId: 'U1' });
    expect(second.modelRouter.route).not.toHaveBeenCalled();
    expect(second.sites[0].data.title).toBe(previous.title);
    expect(calls).toBeGreaterThan(0);
  });

  it.each([1, 2])(
    '%i번째 사이트 쓰기 실패 후 재실행하면 정상 실행 상태로 수렴한다',
    async (failureAt) => {
      const secondRepo = 'AAA/sample';
      const secondSlug = 'aaa-sample';
      const secondWork = {
        ...PROFILE.accomplishments[0],
        title: '두 번째 작업',
        evidence: [
          {
            repo: secondRepo,
            pr: 2,
            url: `https://github.com/${secondRepo}/pull/2`,
            mergedAt: '2026-08-15T01:00:00Z',
          },
        ],
      };
      const profile = {
        ...PROFILE,
        accomplishments: [...PROFILE.accomplishments, secondWork],
      };
      const initialRows = [
        row(),
        row({
          slug: secondSlug,
          repo: secondRepo.toLowerCase(),
          memberPrs: ['aaa/sample#2'],
          siteProjectId: 'p2',
        }),
      ];
      const initialSites = [
        site(),
        site({
          id: 'p2',
          slug: secondSlug,
          data: { ...site().data, slug: secondSlug },
        }),
      ];
      const clean = createFixture({
        profile,
        rows: initialRows.map((item) => ({ ...item })),
        sites: initialSites.map((item) => ({
          ...item,
          data: { ...item.data },
        })),
      });
      await clean.usecase.execute({ slackUserId: 'U1' });

      const retry = createFixture({
        profile,
        rows: initialRows.map((item) => ({ ...item })),
        sites: initialSites.map((item) => ({
          ...item,
          data: { ...item.data },
        })),
      });
      const update = retry.client.updateProject as jest.Mock;
      const normalUpdate = update.getMockImplementation();
      for (let index = 1; index < failureAt; index += 1) {
        update.mockImplementationOnce(normalUpdate!);
      }
      update.mockRejectedValueOnce(new Error('일시 오류'));
      const first = await retry.usecase.execute({ slackUserId: 'U1' });
      expect(first.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: '일시 오류' }),
        ]),
      );
      await retry.usecase.execute({ slackUserId: 'U1' });
      expect(retry.sites).toEqual(clean.sites);
      expect(retry.rows).toEqual(clean.rows);
    },
  );
});
