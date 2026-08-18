import { ConfigService } from '@nestjs/config';

import {
  PublishPortfolioSiteResult,
  PublishPortfolioSiteUsecase,
} from '../../../agent/career-mate/application/publish-portfolio-site.usecase';
import { PortfolioPublishAutopilotTask } from './portfolio-publish.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-18' };

const RESULT: PublishPortfolioSiteResult = {
  createdProjects: [],
  updatedProjects: [],
  createdSkillGroups: [],
  updatedSkillGroups: [],
  skippedTitles: [],
  failures: [],
  publicSlugsAfter: null,
  agentRunId: 1,
};

const createFixture = (
  result: Partial<PublishPortfolioSiteResult> = {},
  env: Record<string, string | undefined> = {
    PORTFOLIO_SITE_URL: 'https://portfolio.example.com',
    PORTFOLIO_AUTOMATION_TOKEN: 'token',
  },
) => {
  const publish = {
    execute: jest.fn().mockResolvedValue({ ...RESULT, ...result }),
  };
  const config = { get: jest.fn((key: string) => env[key]) };
  return {
    task: new PortfolioPublishAutopilotTask(
      publish as unknown as PublishPortfolioSiteUsecase,
      config as unknown as ConfigService,
    ),
    publish,
  };
};

describe('PortfolioPublishAutopilotTask', () => {
  it('자동화 토큰이 없으면 발행을 시도하지 않는다', async () => {
    const { task, publish } = createFixture(
      {},
      {
        PORTFOLIO_SITE_URL: 'https://portfolio.example.com',
      },
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(publish.execute).not.toHaveBeenCalled();
  });

  it('사이트 주소가 없으면 발행을 시도하지 않는다', async () => {
    const { task, publish } = createFixture(
      {},
      {
        PORTFOLIO_AUTOMATION_TOKEN: 'token',
      },
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(publish.execute).not.toHaveBeenCalled();
  });

  it('갱신만 있는 날은 보고하지 않는다 (같은 성과를 매일 다시 밀어 넣으므로)', async () => {
    const { task } = createFixture({ updatedProjects: ['a-pr-1', 'b-pr-2'] });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('새 프로젝트가 생기면 비공개 초안임을 함께 알린다', async () => {
    const { task } = createFixture({ createdProjects: ['a-pr-1'] });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('새 프로젝트 1건');
    expect(result.summaryText).toContain('비공개 초안');
    expect(result.detailText).toContain('a-pr-1');
  });

  it('근거 PR 이 없어 건너뛴 성과도 사람에게 올린다', async () => {
    const { task } = createFixture({ skippedTitles: ['근거 없는 성과'] });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('건너뜀 1건');
    expect(result.detailText).toContain('근거 없는 성과');
  });

  it('개별 실패도 사유와 함께 올린다', async () => {
    const { task } = createFixture({
      failures: [{ target: 'project:a-pr-1', reason: 'HTTP 409' }],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain('실패 1건');
    expect(result.detailText).toContain('HTTP 409');
  });

  it('발행이 통째로 터지면 사유를 담아 알린다', async () => {
    const publish = {
      execute: jest
        .fn()
        .mockRejectedValue(new Error('PORTFOLIO_SITE_URL 미설정')),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'PORTFOLIO_SITE_URL' ? 'https://x' : 'token',
      ),
    };
    const task = new PortfolioPublishAutopilotTask(
      publish as unknown as PublishPortfolioSiteUsecase,
      config as unknown as ConfigService,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('발행 실패');
    expect(result.summaryText).toContain('PORTFOLIO_SITE_URL 미설정');
  });

  it('공개 확인을 건너뛴 경우 그 사실이 발행 실패로 읽히지 않게 적는다', async () => {
    const { task } = createFixture({
      createdProjects: ['a-pr-1'],
      publicSlugsAfter: null,
    });

    const result = await task.run(context);

    expect(result.detailText).toContain('건너뜀 (PORTFOLIO_SITE_HANDLE 미설정');
  });

  it('공개 페이지에서 발행분을 확인하면 그 결과를 적는다', async () => {
    const { task } = createFixture({
      createdProjects: ['a-pr-1'],
      publicSlugsAfter: ['a-pr-1', 'old-pr-9'],
    });

    const result = await task.run(context);

    expect(result.detailText).toContain('발행분 전부 조회됨');
  });
});
