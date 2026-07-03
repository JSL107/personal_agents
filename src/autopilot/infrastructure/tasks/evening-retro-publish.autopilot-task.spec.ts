import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { EveningRetroPublishTask } from './evening-retro-publish.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-03' };

const RETRO_RESPONSE = {
  text: JSON.stringify({
    retrospective: 'r',
    candidates: [
      { title: 'T', keywords: ['k'], blogValueScore: 70, reason: 'x' },
    ],
  }),
  modelUsed: 'gpt',
  provider: 'CHATGPT',
};

const PR_ITEM = {
  repo: 'owner/repo',
  number: 1,
  url: 'https://x',
  title: 't',
  body: 'b',
  mergedAt: '2026-07-03',
  additions: 0,
  deletions: 0,
  changedFilesCount: 0,
};

const makeTask = (opts: {
  enabledVal?: string;
  prs?: (typeof PR_ITEM)[];
  worklogRuns?: { id: number; output: unknown; endedAt: Date }[];
  dailyEvalRuns?: { id: number; output: unknown; endedAt: Date }[];
  routeResult?: { text: string; modelUsed: string; provider: string };
}) => {
  const config = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'EVENING_RETRO_PUBLISH_ENABLED') {
        return opts.enabledVal;
      }
      if (key === 'IMPACT_REPORT_GITHUB_AUTHOR') {
        return 'me';
      }
      return undefined;
    }),
  };

  const githubClient = {
    listAuthorMergedPullRequestsSince: jest
      .fn()
      .mockResolvedValue(opts.prs ?? []),
  };

  const agentRunService = {
    findRecentSucceededRuns: jest
      .fn()
      .mockImplementation((args: { agentType: AgentType }) => {
        if (args.agentType === AgentType.WORK_REVIEWER) {
          return Promise.resolve(opts.worklogRuns ?? []);
        }
        if (args.agentType === AgentType.PO_EVAL) {
          return Promise.resolve(opts.dailyEvalRuns ?? []);
        }
        return Promise.resolve([]);
      }),
  };

  const modelRouter = {
    route: jest.fn().mockResolvedValue(opts.routeResult ?? RETRO_RESPONSE),
  };

  const task = new EveningRetroPublishTask(
    agentRunService as never,
    githubClient as never,
    modelRouter as never,
    config as never,
  );

  return { task, config, githubClient, agentRunService, modelRouter };
};

describe('EveningRetroPublishTask', () => {
  it('(a) EVENING_RETRO_PUBLISH_ENABLED=false 이면 skip=true, route 미호출', async () => {
    const { task, modelRouter } = makeTask({ enabledVal: 'false' });

    const result = await task.run(CTX);

    expect(result.skip).toBe(true);
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('(b) 소스 전무(PR 0건, worklog null, dailyEval null) → skip=true, route 미호출', async () => {
    const { task, modelRouter } = makeTask({
      prs: [],
      worklogRuns: [],
      dailyEvalRuns: [],
    });

    const result = await task.run(CTX);

    expect(result.skip).toBe(true);
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('(c) PR 1건 있음 → previews.length === 2, 경력 payload.prRefs에 owner/repo#1 포함', async () => {
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.previews).toHaveLength(2);

    const careerPreview = result.previews?.find(
      (p) => p.kind === PREVIEW_KIND.EVENING_CAREER_REFLECT,
    );
    expect(careerPreview).toBeDefined();
    expect((careerPreview?.payload as { prRefs: string[] }).prRefs).toContain(
      'owner/repo#1',
    );
  });

  it('(d) PR 없음 + worklog run 1건 있음 → previews.length === 1 (블로그만)', async () => {
    const { task } = makeTask({
      prs: [],
      worklogRuns: [{ id: 1, output: 'worklog text', endedAt: new Date() }],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.previews).toHaveLength(1);
    expect(result.previews?.[0].kind).toBe(PREVIEW_KIND.EVENING_BLOG_PUBLISH);
  });
});
