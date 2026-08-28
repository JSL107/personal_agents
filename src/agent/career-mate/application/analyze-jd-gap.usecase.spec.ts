import { TriggerType } from '../../../agent-run/domain/agent-run.type';
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

describe('AnalyzeJdGapUsecase — 자동 수집 경로', () => {
  it('origin 이 JOB_FEED 면 목표 공고를 저장하지 않는다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({
      slackUserId: 'U1',
      jdText: '• 백엔드 경력 3년 이상',
      origin: 'JOB_FEED',
      company: '토스',
      role: '백엔드 개발자',
    });

    // 저장하면 사용자가 등록한 목표 공고가 매일 자동 수집물로 밀린다.
    expect(d.targetJdRepository.save).not.toHaveBeenCalled();
  });

  it('origin 이 JOB_FEED 면 주제 선택 카드를 띄우지 않는다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({
      slackUserId: 'U1',
      jdText: '• 백엔드 경력 3년 이상',
      origin: 'JOB_FEED',
      company: '토스',
      role: '백엔드 개발자',
    });

    // 대기 카드 조회에 종류 필터가 없어, 살아 있으면 사용자의 다음 답변을 가로챈다.
    expect(d.createPreview.execute).not.toHaveBeenCalled();
  });

  it('origin 이 없으면 기존 멘션 경로 그대로 저장하고 카드를 띄운다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({
      slackUserId: 'U1',
      jdText: '토스\n백엔드 개발자\n• 요건',
    });

    expect(d.targetJdRepository.save).toHaveBeenCalled();
    expect(d.createPreview.execute).toHaveBeenCalled();
  });

  it('회사와 직무를 받으면 본문에서 추측하지 않는다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({
      slackUserId: 'U1',
      jdText: '• Java/Spring 기반 서버 개발 5년 이상\n• MSA 경험',
      origin: 'USER',
      company: '토스',
      role: '백엔드 개발자',
    });

    // 추측 함수는 "앞 3줄 중 가장 짧은 줄" 을 직무로 잡는다 —
    // 자격요건 불릿을 넣으면 회사명 자리에 "• MSA 경험" 같은 값이 들어간다.
    expect(d.targetJdRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ company: '토스', role: '백엔드 개발자' }),
    );
  });

  it('회사와 직무는 inputSnapshot 에도 그대로 실려 감사 근거로 남는다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({
      slackUserId: 'U1',
      jdText: '• Java/Spring 기반 서버 개발 5년 이상\n• MSA 경험',
      origin: 'JOB_FEED',
      company: '토스',
      role: '백엔드 개발자',
    });

    const call = d.agentRunService.execute.mock.calls[0][0] as unknown as {
      inputSnapshot: { company?: string; role?: string };
    };
    expect(call.inputSnapshot.company).toBe('토스');
    expect(call.inputSnapshot.role).toBe('백엔드 개발자');
  });

  it('triggerType 을 넘기면 그대로 AgentRunService 에 전달한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({
      slackUserId: 'U1',
      jdText: '• 백엔드 경력 3년 이상',
      origin: 'JOB_FEED',
      company: '토스',
      role: '백엔드 개발자',
      triggerType: TriggerType.AUTOPILOT_JOB_FEED_GAP_CRON,
    });

    const call = d.agentRunService.execute.mock.calls[0][0] as unknown as {
      triggerType: TriggerType;
    };
    expect(call.triggerType).toBe(TriggerType.AUTOPILOT_JOB_FEED_GAP_CRON);
  });

  it('triggerType 을 안 넘기면 기존 슬랙 멘션 트리거로 동작한다', async () => {
    const d = makeDeps({
      id: 1,
      agentRunId: 5,
      profileJson: PROFILE,
      createdAt: new Date(),
    });

    await build(d).execute({ slackUserId: 'U1', jdText: 'K8s 필수' });

    const call = d.agentRunService.execute.mock.calls[0][0] as unknown as {
      triggerType: TriggerType;
    };
    expect(call.triggerType).toBe(TriggerType.SLACK_MENTION_CAREER_MATE);
  });
});
