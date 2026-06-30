import { CareerMateException } from '../domain/career-mate.exception';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

const PR = {
  number: 1,
  title: '큐 락 수정',
  body: 'lockDuration',
  repo: 'o/r',
  url: 'https://x/1',
  state: 'merged' as const,
  mergedAt: '2026-06-01',
  updatedAt: '2026-06-01',
  additions: 10,
  deletions: 2,
  changedFilesCount: 3,
};

const PROFILE_JSON = JSON.stringify({
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
});

const makeDeps = (prs: unknown[]) => {
  const githubClient = {
    listAuthorMergedPullRequestsSince: jest.fn().mockResolvedValue(prs),
  };
  const modelRouter = {
    route: jest.fn().mockResolvedValue({
      text: PROFILE_JSON,
      modelUsed: 'claude-cli',
      provider: 'CLAUDE',
    }),
  };
  const repository = {
    save: jest.fn().mockResolvedValue({ id: 7 }),
    findLatestBySlackUser: jest.fn(),
  };
  const agentRunService = {
    execute: jest.fn(
      async ({
        run,
      }: {
        run: (c: { agentRunId: number }) => Promise<{
          result: unknown;
          modelUsed: string;
          output: unknown;
        }>;
      }) => {
        const r = await run({ agentRunId: 99 });
        return { result: r.result, modelUsed: r.modelUsed, agentRunId: 99 };
      },
    ),
  };
  const config = { get: jest.fn().mockReturnValue('octo') };
  const humanizer = {
    humanize: jest.fn(async (fields: Record<string, string>) => fields),
  };
  return {
    githubClient,
    modelRouter,
    repository,
    agentRunService,
    config,
    humanizer,
  };
};

describe('BuildCareerProfileUsecase', () => {
  it('PR 을 합성해 프로필을 저장하고 outcome 을 반환한다', async () => {
    const d = makeDeps([PR]);
    const usecase = new BuildCareerProfileUsecase(
      d.githubClient as never,
      d.modelRouter as never,
      d.repository as never,
      d.agentRunService as never,
      d.config as never,
      d.humanizer as never,
    );

    const outcome = await usecase.execute({ slackUserId: 'U1' });

    expect(outcome.agentRunId).toBe(99);
    expect(d.repository.save).toHaveBeenCalledTimes(1);
    expect(d.repository.save.mock.calls[0][0].agentRunId).toBe(99);
    expect(d.repository.save.mock.calls[0][0].prCount).toBe(1);
  });

  it('merged PR 이 없으면 NO_EVIDENCE 예외', async () => {
    const d = makeDeps([]);
    const usecase = new BuildCareerProfileUsecase(
      d.githubClient as never,
      d.modelRouter as never,
      d.repository as never,
      d.agentRunService as never,
      d.config as never,
      d.humanizer as never,
    );
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });

  it('GITHUB_OWNER_LOGIN 미설정 시 CONFIG_MISSING 예외', async () => {
    const d = makeDeps([PR]);
    d.config.get = jest.fn().mockReturnValue(undefined);
    const usecase = new BuildCareerProfileUsecase(
      d.githubClient as never,
      d.modelRouter as never,
      d.repository as never,
      d.agentRunService as never,
      d.config as never,
      d.humanizer as never,
    );
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });
});
