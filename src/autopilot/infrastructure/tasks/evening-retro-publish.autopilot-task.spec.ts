import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { EveningRetroPublishTask } from './evening-retro-publish.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-03' };

const RETRO_RESPONSE = {
  text: JSON.stringify({
    retrospective: 'r',
    candidates: [
      {
        title: 'T',
        keywords: ['k'],
        blogValueScore: 70,
        reason: '실제 PR 근거가 충분하다.',
        sourceRefs: ['schoolbell-e/sbe-api-v5#864'],
      },
    ],
  }),
  modelUsed: 'gpt',
  provider: 'CHATGPT',
};

const PR_ITEM = {
  repo: 'schoolbell-e/sbe-api-v5',
  number: 864,
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
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T16:30:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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

  it('(c) PR 1건 있음 → previews.length === 2, 경력 payload.prRefs에 schoolbell-e/sbe-api-v5#864 포함', async () => {
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
      'schoolbell-e/sbe-api-v5#864',
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

  it('(e) GitHub merged 조회는 오늘 KST 00:00 offset timestamp 를 sinceIsoDate 로 사용한다', async () => {
    const { task, githubClient } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    expect(githubClient.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      expect.objectContaining({
        sinceIsoDate: '2026-07-08T00:00:00+09:00',
      }),
    );
  });

  it('(f) 회고 prompt 에 회사/개인 소스 라벨을 포함한다', async () => {
    const personalPr = {
      ...PR_ITEM,
      repo: 'JSL107/personal_agents',
      number: 142,
      title: '개인 PR',
    };
    const { task, modelRouter } = makeTask({
      prs: [PR_ITEM, personalPr],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    await task.run(CTX);

    const routeInput = modelRouter.route.mock.calls[0][0];
    expect(routeInput.request.prompt).toContain(
      '[회사 실무][schoolbell-e/sbe-api-v5#864]',
    );
    expect(routeInput.request.prompt).toContain(
      '[개인 프로젝트][JSL107/personal_agents#142]',
    );
  });

  it('(g) summary 와 블로그 preview 에 reason/sourceRefs/sourcePrs 를 반영한다', async () => {
    const { task } = makeTask({
      prs: [PR_ITEM],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);
    const blogPreview = result.previews?.find(
      (preview) => preview.kind === PREVIEW_KIND.EVENING_BLOG_PUBLISH,
    );
    const payload = blogPreview?.payload as {
      topPick: {
        title: string;
        keywords: string[];
        reason: string;
        sourceRefs: string[];
      };
      sourcePrs: Array<{
        repo: string;
        number: number;
        url: string;
        title: string;
        body: string;
      }>;
    };

    expect(result.summaryText).toContain('회사 실무');
    expect(result.summaryText).toContain('실제 PR 근거가 충분하다.');
    expect(blogPreview?.previewText).toContain('근거 PR: sbe-api-v5#864');
    expect(blogPreview?.previewText).toContain(
      '왜 쓸 가치: 실제 PR 근거가 충분하다.',
    );
    expect(payload.topPick.reason).toBe('실제 PR 근거가 충분하다.');
    expect(payload.topPick.sourceRefs).toEqual(['schoolbell-e/sbe-api-v5#864']);
    expect(payload.sourcePrs).toEqual([
      {
        repo: 'schoolbell-e/sbe-api-v5',
        number: 864,
        url: 'https://x',
        title: 't',
        body: 'b',
      },
    ]);
  });

  it('(h) 경력 preview 는 회사/개인 repository 를 그룹화해서 표시한다', async () => {
    const personalPr = {
      ...PR_ITEM,
      repo: 'JSL107/personal_agents',
      number: 142,
    };
    const { task } = makeTask({
      prs: [PR_ITEM, personalPr],
      worklogRuns: [],
      dailyEvalRuns: [],
      routeResult: RETRO_RESPONSE,
    });

    const result = await task.run(CTX);
    const careerPreview = result.previews?.find(
      (preview) => preview.kind === PREVIEW_KIND.EVENING_CAREER_REFLECT,
    );

    expect(careerPreview?.previewText).toContain(
      '• 회사 실무: schoolbell-e/sbe-api-v5#864',
    );
    expect(careerPreview?.previewText).toContain(
      '• 개인 프로젝트(이대리): JSL107/personal_agents#142',
    );
  });
});
