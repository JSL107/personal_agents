import { BeFixException } from '../domain/be-fix.exception';
import { BeFixErrorCode } from '../domain/be-fix-error-code.enum';
import { AnalyzePrConventionUsecase } from './analyze-pr-convention.usecase';

const makeMockAgentRunService = () => ({
  execute: jest
    .fn()
    .mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => {
      const execution = await run();
      return {
        result: (execution as { result: unknown }).result,
        modelUsed: 'claude',
        agentRunId: 1,
      };
    }),
});

const makeMockModelRouter = (
  text = '{"violations":[],"summary":"컨벤션 통과"}',
) => ({
  route: jest.fn().mockResolvedValue({ text, modelUsed: 'claude-3-5-sonnet' }),
});

const makeMockGithubClient = () => ({
  getPullRequest: jest.fn().mockResolvedValue({
    number: 42,
    title: 'fix: some bug',
    body: '',
    repo: 'owner/repo',
    url: 'https://github.com/owner/repo/pull/42',
    baseRef: 'main',
    headRef: 'feature/fix',
    authorLogin: 'dev',
    changedFiles: ['src/foo.ts'],
    changedFilesTruncated: false,
    changedFilesTotalCount: 1,
    additions: 10,
    deletions: 3,
  }),
  getPullRequestDiff: jest.fn().mockResolvedValue({
    diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,3 +1,3 @@',
    truncated: false,
    bytes: 50,
  }),
  listMyAssignedTasks: jest.fn(),
  addIssueComment: jest.fn(),
});

describe('AnalyzePrConventionUsecase', () => {
  it('빈 prRef → EMPTY_PR_REF 예외', async () => {
    const usecase = new AnalyzePrConventionUsecase(
      null as never,
      null as never,
      null as never,
    );

    await expect(
      usecase.execute({ prRef: '   ', slackUserId: 'U1' }),
    ).rejects.toThrow(BeFixException);

    await expect(
      usecase.execute({ prRef: '   ', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ beFixErrorCode: BeFixErrorCode.EMPTY_PR_REF });
  });

  it('잘못된 prRef → INVALID_PR_REF 예외', async () => {
    const usecase = new AnalyzePrConventionUsecase(
      null as never,
      null as never,
      null as never,
    );

    await expect(
      usecase.execute({ prRef: 'aaa#bbb!', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ beFixErrorCode: BeFixErrorCode.INVALID_PR_REF });
  });

  it('PR fetch 실패 → PR_FETCH_FAILED 예외', async () => {
    const githubClient = makeMockGithubClient();
    githubClient.getPullRequest.mockRejectedValue(new Error('network error'));

    const usecase = new AnalyzePrConventionUsecase(
      makeMockModelRouter() as never,
      makeMockAgentRunService() as never,
      githubClient as never,
    );

    await expect(
      usecase.execute({ prRef: 'owner/repo#42', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ beFixErrorCode: BeFixErrorCode.PR_FETCH_FAILED });
  });

  it('정상 실행 — violations 채워서 반환', async () => {
    const llmResponse = JSON.stringify({
      violations: [
        {
          filePath: 'src/foo.ts',
          line: 10,
          category: 'magic-number',
          message: '300 은 상수로 추출해야 합니다.',
          suggestedFix: '```ts\nconst TIMEOUT = 300;\n```',
        },
      ],
      summary: '1건 발견.',
    });

    const usecase = new AnalyzePrConventionUsecase(
      makeMockModelRouter(llmResponse) as never,
      makeMockAgentRunService() as never,
      makeMockGithubClient() as never,
    );

    const outcome = await usecase.execute({
      prRef: 'owner/repo#42',
      slackUserId: 'U1',
    });

    expect(outcome.result.violations).toHaveLength(1);
    expect(outcome.result.prTitle).toBe('fix: some bug');
    expect(outcome.result.prRef).toBe('owner/repo#42');
    expect(outcome.result.diffTruncated).toBe(false);
  });

  it('diff 가 truncated 인 경우 → diffTruncated:true 반환', async () => {
    const githubClient = makeMockGithubClient();
    githubClient.getPullRequestDiff.mockResolvedValue({
      diff: 'a'.repeat(50_000),
      truncated: true,
      bytes: 100_001,
    });

    const usecase = new AnalyzePrConventionUsecase(
      makeMockModelRouter() as never,
      makeMockAgentRunService() as never,
      githubClient as never,
    );

    const outcome = await usecase.execute({
      prRef: 'owner/repo#42',
      slackUserId: 'U1',
    });

    expect(outcome.result.diffTruncated).toBe(true);
  });

  it('owner/repo#N 형식 파싱', async () => {
    const githubClient = makeMockGithubClient();

    const usecase = new AnalyzePrConventionUsecase(
      makeMockModelRouter() as never,
      makeMockAgentRunService() as never,
      githubClient as never,
    );

    await usecase.execute({
      prRef: 'octocat/hello-world#7',
      slackUserId: 'U2',
    });

    expect(githubClient.getPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'octocat/hello-world', number: 7 }),
    );
  });

  it('full URL 형식 파싱', async () => {
    const githubClient = makeMockGithubClient();

    const usecase = new AnalyzePrConventionUsecase(
      makeMockModelRouter() as never,
      makeMockAgentRunService() as never,
      githubClient as never,
    );

    await usecase.execute({
      prRef: 'https://github.com/owner/repo/pull/99',
      slackUserId: 'U3',
    });

    expect(githubClient.getPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'owner/repo', number: 99 }),
    );
  });
});
