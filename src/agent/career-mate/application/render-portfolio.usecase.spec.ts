import { CareerMateException } from '../domain/career-mate.exception';
import { CareerProfileData } from '../domain/career-mate.type';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const makeDeps = (latest: unknown) => {
  const repository = {
    findLatestBySlackUser: jest.fn().mockResolvedValue(latest),
  };
  const buildProfile = {
    execute: jest.fn().mockResolvedValue({
      result: PROFILE,
      modelUsed: 'claude-cli',
      agentRunId: 88,
    }),
  };
  const notionClient = {
    findOrCreateChildPage: jest
      .fn()
      .mockResolvedValue({ pageId: 'p1', url: 'https://notion/p1' }),
    replaceAllBlocks: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('PARENT_PAGE') };
  return { repository, buildProfile, notionClient, config };
};

describe('RenderPortfolioUsecase', () => {
  it('프로필을 Notion 자식 페이지에 미러링하고 url 을 반환한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(d.notionClient.findOrCreateChildPage).toHaveBeenCalledTimes(1);
    expect(d.notionClient.replaceAllBlocks).toHaveBeenCalledTimes(1);
    expect(result.url).toBe('https://notion/p1');
    expect(result.agentRunId).toBe(5);
  });

  it('CAREER_PORTFOLIO_NOTION_PAGE_ID 미설정 시 CONFIG_MISSING', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    d.config.get = jest.fn().mockReturnValue(undefined);
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });
});
