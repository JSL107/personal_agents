import { CareerMateException } from '../domain/career-mate.exception';
import { CareerProfileData } from '../domain/career-mate.type';
import { AnalyzeJdGapUsecase } from './analyze-jd-gap.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const GAP_JSON = JSON.stringify({
  fitSummary: 'f',
  have: ['NestJS'],
  gaps: ['K8s'],
  topics: [{ title: 'K8s 회고', rationale: 'K8s 갭' }],
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
      text: GAP_JSON,
      modelUsed: 'claude-cli',
      provider: 'CLAUDE',
    }),
  };
  const createPreview = { execute: jest.fn().mockResolvedValue({ id: 'pv1' }) };
  const targetJdRepository = {
    save: jest.fn().mockResolvedValue(undefined),
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
  return {
    repository,
    buildProfile,
    modelRouter,
    createPreview,
    targetJdRepository,
    agentRunService,
  };
};

const build = (d: ReturnType<typeof makeDeps>) =>
  new AnalyzeJdGapUsecase(
    d.repository as never,
    d.buildProfile as never,
    d.modelRouter as never,
    d.createPreview as never,
    d.targetJdRepository as never,
    d.agentRunService as never,
  );

describe('AnalyzeJdGapUsecase', () => {
  it('허브+JD 로 갭 분석 후 preview 를 생성한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    const outcome = await build(d).execute({
      slackUserId: 'U1',
      jdText: 'K8s 필수',
    });
    expect(outcome.result.gaps).toContain('K8s');
    expect(d.createPreview.execute).toHaveBeenCalledTimes(1);
    expect(d.createPreview.execute.mock.calls[0][0].kind).toBe(
      'CAREER_JD_GAP_BLOG',
    );
    expect(
      (
        d.createPreview.execute.mock.calls[0][0].payload as {
          topics: { title: string }[];
        }
      ).topics[0].title,
    ).toBe('K8s 회고');
    expect(d.buildProfile.execute).not.toHaveBeenCalled();
  });

  it('허브 없으면 자동 Build 후 분석', async () => {
    const d = makeDeps(null);
    await build(d).execute({ slackUserId: 'U1', jdText: 'K8s 필수' });
    expect(d.buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
  });

  it('분석 성공 후 공고 회사와 역할을 결정론으로 추출해 저장한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    const jdText = '이대리 주식회사\n백엔드\nNestJS 운영 경험 필수';

    await build(d).execute({ slackUserId: 'U1', jdText });

    expect(d.targetJdRepository.save).toHaveBeenCalledWith({
      slackUserId: 'U1',
      company: '이대리 주식회사',
      role: '백엔드',
      jdText,
    });
  });

  it('공고 저장이 실패해도 갭 분석과 preview 응답을 보존한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    d.targetJdRepository.save.mockRejectedValueOnce(
      new Error('DB unavailable'),
    );

    const outcome = await build(d).execute({
      slackUserId: 'U1',
      jdText: 'K8s 필수',
    });

    expect(outcome.result.gaps).toContain('K8s');
    expect(d.createPreview.execute).toHaveBeenCalledTimes(1);
  });

  it('JD 비어있으면 JD_EMPTY 예외', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });
    await expect(
      build(d).execute({ slackUserId: 'U1', jdText: '   ' }),
    ).rejects.toBeInstanceOf(CareerMateException);
    expect(d.targetJdRepository.save).not.toHaveBeenCalled();
  });
});
