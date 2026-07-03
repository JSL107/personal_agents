import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CareerProfileRepositoryPort } from '../domain/port/career-profile.repository.port';
import { ReflectPrUsecase } from './reflect-pr.usecase';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';

const SYNTH = JSON.stringify({
  accomplishment: {
    title: 'T',
    bullet: 'B',
    star: { situation: 's', task: 't', action: 'a', result: 'r' },
    techTags: ['NestJS'],
    evidence: [
      {
        repo: 'o/r',
        pr: 1692,
        url: 'https://x/pull/1692',
        mergedAt: '2026-06-30',
      },
    ],
  },
  narrative: '회고 서술',
});

const MULTI_SYNTH = JSON.stringify({
  accomplishment: {
    title: 'T',
    bullet: 'B',
    star: { situation: 's', task: 't', action: 'a', result: 'r' },
    techTags: ['NestJS'],
    evidence: [
      { repo: 'o/r', pr: 1, url: 'https://x/pull/1', mergedAt: '2026-06-29' },
      { repo: 'o/r', pr: 2, url: 'https://x/pull/2', mergedAt: '2026-06-30' },
    ],
  },
  narrative: '이어진 두 PR 통합 회고',
});

describe('ReflectPrUsecase', () => {
  const makeUsecase = () => {
    const github = {
      getPullRequest: jest.fn().mockResolvedValue({
        number: 1692,
        title: 'T',
        body: 'B',
        repo: 'o/r',
        url: 'u',
        baseRef: 'main',
        headRef: 'f',
        authorLogin: 'me',
        changedFiles: ['a.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 1,
        deletions: 0,
      }),
      getPullRequestDiff: jest
        .fn()
        .mockResolvedValue({ diff: 'd', truncated: false, bytes: 1 }),
    } as unknown as GithubClientPort;

    const modelRouter = {
      route: jest.fn().mockResolvedValue({ text: SYNTH, modelUsed: 'claude' }),
    } as unknown as ModelRouterUsecase;

    const repository = {
      findLatestBySlackUser: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({ id: 7 }),
    } as unknown as CareerProfileRepositoryPort;

    // humanizer.humanize 는 입력 키를 그대로 반환(best-effort passthrough).
    const humanizer = {
      humanize: jest.fn(async (fields: Record<string, string>) => fields),
    } as unknown as HumanizeService;

    const renderPortfolio = {
      execute: jest.fn().mockResolvedValue({
        url: 'https://notion/p',
        pageId: 'p',
        agentRunId: 0,
      }),
    } as unknown as RenderPortfolioUsecase;

    const config = {
      get: jest.fn().mockReturnValue('me'),
    } as unknown as ConfigService;

    const agentRunService = {
      execute: jest.fn(async ({ run }) => {
        const out = await run({ agentRunId: 55 });
        return { agentRunId: 55, result: out.result, modelUsed: out.modelUsed };
      }),
    } as unknown as AgentRunService;

    const usecase = new ReflectPrUsecase(
      github,
      modelRouter,
      repository,
      agentRunService,
      config,
      humanizer,
      renderPortfolio,
    );
    return { usecase, github, repository, renderPortfolio, modelRouter };
  };

  it('PR fetch→합성→편입 저장→포폴 append 를 수행한다', async () => {
    const { usecase, github, repository, renderPortfolio } = makeUsecase();
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      prText: '이 PR 회고 https://github.com/o/r/pull/1692 이력서에',
    });

    expect(github.getPullRequest).toHaveBeenCalledWith({
      repo: 'o/r',
      number: 1692,
    });
    expect(repository.save).toHaveBeenCalled();
    expect(renderPortfolio.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(outcome.result.portfolioUrl).toBe('https://notion/p');
    expect(outcome.result.accomplishment.evidence[0].pr).toBe(1692);
    expect(outcome.result.narrative).toBe('회고 서술');
  });

  it('단일 링크는 maxBytes 없이 기존 diff 호출을 유지한다 (회귀 lock)', async () => {
    const { usecase, github } = makeUsecase();
    await usecase.execute({
      slackUserId: 'U1',
      prText: '이 PR 회고 https://github.com/o/r/pull/1692',
    });
    expect(github.getPullRequestDiff).toHaveBeenCalledWith({
      repo: 'o/r',
      number: 1692,
    });
  });

  it('여러 링크는 각 PR 을 fetch 하고 통합 성과 1건으로 저장한다', async () => {
    const { usecase, github, repository, renderPortfolio, modelRouter } =
      makeUsecase();
    (github.getPullRequest as jest.Mock).mockImplementation(
      async ({ number }: { number: number }) => ({
        number,
        title: `T${number}`,
        body: 'B',
        repo: 'o/r',
        url: `u${number}`,
        baseRef: 'main',
        headRef: 'f',
        authorLogin: 'me',
        changedFiles: ['a.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 1,
        deletions: 0,
      }),
    );
    (github.getPullRequestDiff as jest.Mock).mockResolvedValue({
      diff: 'd',
      truncated: false,
      bytes: 1,
    });
    (modelRouter.route as jest.Mock).mockResolvedValue({
      text: MULTI_SYNTH,
      modelUsed: 'codex',
    });

    const outcome = await usecase.execute({
      slackUserId: 'U1',
      prText:
        '이 PR들 묶어서 회고 https://github.com/o/r/pull/1 https://github.com/o/r/pull/2',
    });

    expect(github.getPullRequest).toHaveBeenCalledTimes(2);
    expect(github.getPullRequest).toHaveBeenCalledWith({
      repo: 'o/r',
      number: 1,
    });
    expect(github.getPullRequest).toHaveBeenCalledWith({
      repo: 'o/r',
      number: 2,
    });
    // N>1 이면 per-PR diff 예산 분할 (80000/2 = 40000).
    expect(github.getPullRequestDiff).toHaveBeenCalledWith({
      repo: 'o/r',
      number: 1,
      maxBytes: 40000,
    });
    expect(modelRouter.route).toHaveBeenCalledTimes(1);
    expect(repository.save).toHaveBeenCalled();
    expect(renderPortfolio.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(outcome.result.accomplishment.evidence).toHaveLength(2);
    expect(outcome.result.narrative).toBe('이어진 두 PR 통합 회고');
  });
});
