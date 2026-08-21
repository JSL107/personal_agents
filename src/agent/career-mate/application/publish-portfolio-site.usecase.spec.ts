import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CareerProfileData } from '../domain/career-mate.type';
import { CareerProfileRepositoryPort } from '../domain/port/career-profile.repository.port';
import {
  PortfolioSiteClientPort,
  PortfolioSiteProject,
} from '../domain/port/portfolio-site.client.port';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';
import { PublishPortfolioSiteUsecase } from './publish-portfolio-site.usecase';

const PROFILE: CareerProfileData = {
  summary: '백엔드 개발자',
  skills: [
    {
      name: 'TypeScript',
      category: 'LANGUAGE',
      proficiency: 'EXPERT',
      evidence: [
        {
          repo: 'JSL107/personal_agents',
          pr: 313,
          url: 'https://github.com/JSL107/personal_agents/pull/313',
        },
      ],
    },
  ],
  accomplishments: [
    {
      title: '백테스트 재생 루프',
      bullet: '과거를 재생해 성적을 낸다',
      star: {
        situation: '비교할 수 없었다',
        task: '재생 루프 설계',
        action: 'usecase 구현',
        result: '수치 비교 가능',
      },
      techTags: ['TypeScript'],
      evidence: [
        {
          repo: 'JSL107/personal_agents',
          pr: 313,
          url: 'https://github.com/JSL107/personal_agents/pull/313',
          mergedAt: '2026-08-14T01:00:00Z',
        },
      ],
    },
  ],
  meta: { githubLogin: 'JSL107', windowStart: '2026-06-01', prCount: 3 },
};

const SLUG = 'jsl107-personal-agents';

const createFixture = (
  clientOverrides: Partial<PortfolioSiteClientPort> = {},
  latest: {
    profileJson: CareerProfileData;
    agentRunId: number | null;
  } | null = {
    profileJson: PROFILE,
    agentRunId: 77,
  },
  anonymizedOwners: string | undefined = undefined,
) => {
  const client: PortfolioSiteClientPort = {
    listProjects: jest.fn().mockResolvedValue([]),
    createProject: jest
      .fn()
      .mockImplementation(async (data: Record<string, unknown>) => ({
        id: 'p1',
        slug: String(data.slug),
        published: false,
        data,
      })),
    updateProject: jest
      .fn()
      .mockImplementation(
        async (id: string, data: Record<string, unknown>) =>
          ({ id, slug: SLUG, published: true, data }) as PortfolioSiteProject,
      ),
    listSkillGroups: jest.fn().mockResolvedValue([]),
    createSkillGroup: jest
      .fn()
      .mockImplementation(async (data: Record<string, unknown>) => ({
        id: 'g1',
        sortOrder: 1,
        data,
      })),
    updateSkillGroup: jest
      .fn()
      .mockImplementation(
        async (id: string, data: Record<string, unknown>) => ({
          id,
          sortOrder: 1,
          data,
        }),
      ),
    ...clientOverrides,
  };
  const repository = {
    save: jest.fn(),
    findLatestBySlackUser: jest
      .fn()
      .mockResolvedValue(
        latest ? { id: 1, ...latest, createdAt: new Date() } : null,
      ),
  } as unknown as CareerProfileRepositoryPort;
  const buildProfile = {
    execute: jest.fn().mockResolvedValue({ result: PROFILE, agentRunId: 99 }),
  } as unknown as BuildCareerProfileUsecase;
  // 모델은 묶음마다 이름을 돌려준다 — 발행 배선 테스트라 이름 품질은 여기서 보지 않는다.
  const modelRouter = {
    route: jest
      .fn()
      .mockImplementation(
        async ({ request }: { request: { prompt: string } }) => {
          const keys = [...request.prompt.matchAll(/^key: (.+)$/gm)].map(
            (match) => match[1],
          );
          return {
            text: JSON.stringify({
              projects: keys.map((key) => ({
                key,
                title: `${key} 프로젝트`,
                summary: '한 문장',
                problem: '문제',
                result: '결과',
              })),
            }),
          };
        },
      ),
  } as unknown as ModelRouterUsecase;

  return {
    usecase: new PublishPortfolioSiteUsecase(
      repository,
      buildProfile,
      client,
      {
        get: (key: string) =>
          key === 'PORTFOLIO_ANONYMIZED_OWNERS' ? anonymizedOwners : undefined,
      } as unknown as ConfigService,
      modelRouter,
    ),
    modelRouter,
    client,
    buildProfile,
  };
};

describe('PublishPortfolioSiteUsecase', () => {
  it('PORTFOLIO_ANONYMIZED_OWNERS 설정이 발행 본문까지 닿는다', async () => {
    // 익명화 로직 자체는 도메인 테스트가 지킨다. 여기서 지키는 것은 배선이다 — 설정을 읽지
    // 못하면 도메인 테스트는 전부 초록인데 운영 발행만 저장소 이름을 그대로 내보낸다.
    const { usecase, client } = createFixture({}, undefined, 'jsl107');

    await usecase.execute({ slackUserId: 'U1' });

    const [created] = (client.createProject as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(String(created.slug)).toMatch(/^company-[0-9a-f]{6}$/);
    expect(created.links).toEqual({});
  });

  it('설정이 비어 있으면 저장소 이름을 그대로 쓴다', async () => {
    // 대조군 — 위 테스트가 "항상 익명화" 로도 통과하지 않게 한다.
    const { usecase, client } = createFixture();

    await usecase.execute({ slackUserId: 'U1' });

    const [created] = (client.createProject as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(created.slug).toBe(SLUG);
  });

  it('사이트에 없는 성과는 새로 만든다', async () => {
    const { usecase, client } = createFixture();

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.createdProjects).toEqual([SLUG]);
    expect(result.updatedProjects).toEqual([]);
    expect(client.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ slug: SLUG, published: false }),
    );
  });

  it('같은 slug 가 이미 있으면 새로 만들지 않고 갱신한다 (멱등)', async () => {
    const { usecase, client } = createFixture({
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: 'existing-1', slug: SLUG, published: true, data: {} },
        ]),
    });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.createdProjects).toEqual([]);
    expect(result.updatedProjects).toEqual([SLUG]);
    expect(client.createProject).not.toHaveBeenCalled();
    expect(client.updateProject).toHaveBeenCalledWith(
      'existing-1',
      expect.objectContaining({ slug: SLUG }),
    );
  });

  it('갱신할 때 published 를 건드리지 않는다 (사람이 게시한 것을 되돌리지 않는다)', async () => {
    const { usecase, client } = createFixture({
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: 'existing-1', slug: SLUG, published: true, data: {} },
        ]),
    });

    await usecase.execute({ slackUserId: 'U1' });

    const [, payload] = (client.updateProject as jest.Mock).mock.calls[0];
    expect('published' in payload).toBe(false);
  });

  it('갱신할 때 featured 도 건드리지 않는다 (대표작 지정이 매일 풀리면 안 된다)', async () => {
    const { usecase, client } = createFixture({
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: 'existing-1', slug: SLUG, published: true, data: {} },
        ]),
    });

    await usecase.execute({ slackUserId: 'U1' });

    const [, payload] = (client.updateProject as jest.Mock).mock.calls[0];
    // 사이트는 "필드가 있으면 덮는다" 라서 값을 넣지 않는 것이 유일한 보존 방법이다.
    expect('featured' in payload).toBe(false);
    // 내용 필드는 그대로 실려야 한다(표지는 별도 규칙 — 아래 '표지 보존' 참조).
    expect(payload.process).toEqual(['과거를 재생해 성적을 낸다']);
  });

  it('프로젝트 1건이 실패해도 스킬 그룹 발행은 계속한다', async () => {
    const { usecase, client } = createFixture({
      createProject: jest.fn().mockRejectedValue(new Error('HTTP 409')),
    });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.failures).toEqual([
      { target: `project:${SLUG}`, reason: 'HTTP 409' },
    ]);
    expect(client.createSkillGroup).toHaveBeenCalled();
    expect(result.createdSkillGroups).toEqual(['Languages']);
  });

  it('스킬 그룹은 제목으로 맞춰 갱신한다', async () => {
    const { usecase, client } = createFixture({
      listSkillGroups: jest
        .fn()
        .mockResolvedValue([
          { id: 'g-lang', sortOrder: 1, data: { title: 'Languages' } },
        ]),
    });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.updatedSkillGroups).toEqual(['Languages']);
    expect(client.updateSkillGroup).toHaveBeenCalledWith(
      'g-lang',
      expect.objectContaining({ title: 'Languages' }),
    );
  });

  it('저장된 프로필이 없으면 그 자리에서 만들어 쓴다', async () => {
    const { usecase, buildProfile } = createFixture({}, null);

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(result.agentRunId).toBe(99);
  });

  it('발행 후 목록을 다시 읽어 확인한다 (쓰기 응답만 믿지 않는다)', async () => {
    const listProjects = jest
      .fn()
      .mockResolvedValueOnce([]) // 발행 전
      .mockResolvedValueOnce([
        { id: 'p1', slug: SLUG, published: false, data: {} },
      ]); // 발행 후 재조회
    const { usecase } = createFixture({ listProjects });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(listProjects).toHaveBeenCalledTimes(2);
    expect(result.missingAfterPublish).toEqual([]);
  });

  it('재조회에 없으면 저장이 안 된 것으로 보고한다', async () => {
    // 사이트가 200을 주고도 실제로 저장하지 않은 경우 — 쓰기 응답만 보면 성공으로 읽힌다.
    const listProjects = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { usecase } = createFixture({ listProjects });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.missingAfterPublish).toEqual([SLUG]);
  });

  it('재조회 자체가 터지면 실패로 기록하고 미확인을 비운다', async () => {
    const listProjects = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('timeout'));
    const { usecase } = createFixture({ listProjects });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.failures).toEqual([{ target: 'verify', reason: 'timeout' }]);
    expect(result.missingAfterPublish).toEqual([]);
  });
});

describe('표지 보존', () => {
  it('갱신할 때 제목·서술을 다시 보내지 않는다', async () => {
    // 모델은 같은 묶음에도 회차마다 다른 이름을 짓는다(실측 10건 중 7건 변동). 매번 실어
    // 보내면 프로젝트 이름이 매일 흔들리고 사람이 고친 제목도 덮인다.
    const { usecase, client } = createFixture({
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: 'existing-1', slug: SLUG, published: true, data: {} },
        ]),
    });

    await usecase.execute({ slackUserId: 'U1' });

    const [, payload] = (client.updateProject as jest.Mock).mock.calls[0];
    expect('title' in payload).toBe(false);
    expect('summary' in payload).toBe(false);
    expect('problem' in payload).toBe(false);
    expect('result' in payload).toBe(false);
    // 내용은 계속 갱신된다 — 새 작업이 붙어도 목록에 반영돼야 한다.
    expect(payload.process).toEqual(['과거를 재생해 성적을 낸다']);
    expect(payload.period).toBe('2026.08');
  });

  it('처음 만들 때는 표지를 싣는다', async () => {
    const { usecase, client } = createFixture();

    await usecase.execute({ slackUserId: 'U1' });

    const [created] = (client.createProject as jest.Mock).mock.calls[0];
    expect(created.title).toBe(`${SLUG} 프로젝트`);
  });
});
