import { CareerProfileData } from '../domain/career-mate.type';
import { CalibrateResumeUsecase } from './calibrate-resume.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};
const CAL_JSON = JSON.stringify({
  verdict: 'ok',
  aiSlopRisks: [],
  underQuantified: ['x'],
  outdatedPhrasing: [],
  missingKeywords: ['IaC'],
  actionItems: ['정량화'],
});

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
  const modelRouter = {
    route: jest.fn().mockResolvedValue({
      text: CAL_JSON,
      modelUsed: 'claude-cli',
      provider: 'CLAUDE',
    }),
  };
  const agentRunService = {
    execute: jest.fn(
      async ({
        run,
      }: {
        run: (c: {
          agentRunId: number;
        }) => Promise<{ result: unknown; modelUsed: string; output: unknown }>;
      }) => {
        const r = await run({ agentRunId: 99 });
        return { result: r.result, modelUsed: r.modelUsed, agentRunId: 99 };
      },
    ),
  };
  return { repository, buildProfile, modelRouter, agentRunService };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new CalibrateResumeUsecase(
    d.repository as never,
    d.buildProfile as never,
    d.modelRouter as never,
    d.agentRunService as never,
  );

describe('CalibrateResumeUsecase', () => {
  it('허브로 보정 진단을 반환한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    const outcome = await build(d).execute({ slackUserId: 'U1' });
    expect(outcome.result.missingKeywords).toContain('IaC');
    expect(d.buildProfile.execute).not.toHaveBeenCalled();
  });
  it('허브 없으면 자동 Build 후 진단', async () => {
    const d = makeDeps(null);
    await build(d).execute({ slackUserId: 'U1' });
    expect(d.buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
  });
  it('webTrendsNote 가 프롬프트에 반영된다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    await build(d).execute({
      slackUserId: 'U1',
      webTrendsNote: '2026 트렌드 X',
    });
    const prompt = d.modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('2026 트렌드 X');
  });
});
