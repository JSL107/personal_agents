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

  it('deferBlockSync 면 본문 반영이 끝나기 전에 링크를 돌려준다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    // 반영을 끝내지 않고 붙잡아 둔다 — 그 상태로 execute 가 반환되면 기다리지 않은 것이다.
    let finishBlockSync: () => void = () => {};
    d.notionClient.replaceAllBlocks = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishBlockSync = resolve;
        }),
    );
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );

    const result = await usecase.execute({
      slackUserId: 'U1',
      deferBlockSync: true,
    });

    expect(result.url).toBe('https://notion/p1');
    expect(d.notionClient.replaceAllBlocks).toHaveBeenCalledTimes(1);
    finishBlockSync();
  });

  it('deferBlockSync 중 본문 반영이 실패해도 링크는 그대로 반환된다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    d.notionClient.replaceAllBlocks = jest
      .fn()
      .mockRejectedValue(new Error('notion 500'));
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );

    const result = await usecase.execute({
      slackUserId: 'U1',
      deferBlockSync: true,
    });

    expect(result.url).toBe('https://notion/p1');
    // 백그라운드 rejection 이 흡수되는지 — 마이크로태스크를 비워 unhandled 로 새지 않음을 본다.
    await Promise.resolve();
    await Promise.resolve();
  });

  it('deferBlockSync 미지정이면 본문 반영을 끝내고서야 반환한다 (기본값 회귀 lock)', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    let blockSyncDone = false;
    d.notionClient.replaceAllBlocks = jest.fn(async () => {
      await Promise.resolve();
      blockSyncDone = true;
    });
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );

    await usecase.execute({ slackUserId: 'U1' });

    // 기본값이 뒤집히면 RENDER_PORTFOLIO 가 "정리했다" 고 답하고 실제로는 안 된 상태가 된다.
    expect(blockSyncDone).toBe(true);
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
