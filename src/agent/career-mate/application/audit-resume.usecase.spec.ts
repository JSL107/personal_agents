import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { CareerProfileData } from '../domain/career-mate.type';
import { AuditResumeUsecase } from './audit-resume.usecase';

const PROFILE: CareerProfileData = {
  summary: '백엔드 엔지니어',
  skills: [],
  accomplishments: [
    {
      title: '장애율 감소',
      bullet: '재시도 정책으로 장애율을 30% 줄였다.',
      star: {
        situation: '외부 API 장애가 있었다.',
        task: '실패 전파를 줄여야 했다.',
        action: '지수 백오프를 적용했다.',
        result: '장애율을 30% 줄였다.',
      },
      techTags: ['NestJS'],
      evidence: [
        {
          repo: 'owner/api',
          pr: 10,
          url: 'https://example.com/10',
          mergedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2026-01-01', prCount: 1 },
};

const AUDIT_JSON = JSON.stringify({
  verdict: '증거가 확인된다.',
  items: [
    {
      title: '장애율 감소',
      status: 'PROVEN',
      quote: '장애율을 30% 줄였다.',
      why: '정량 결과가 있다.',
      rewrite: null,
    },
  ],
  highlights: [],
  jdFindings: [],
  rejectionRisks: [],
});

const createFixture = ({
  profile = PROFILE,
  targetJd = null,
}: {
  profile?: CareerProfileData;
  targetJd?: {
    id: number;
    company: string;
    role: string;
    jdText: string;
    createdAt: Date;
  } | null;
}) => {
  const repository = {
    findLatestBySlackUser: jest.fn().mockResolvedValue({
      id: 1,
      agentRunId: 5,
      profileJson: profile,
      createdAt: new Date(),
    }),
  };
  const targetJdRepository = {
    findActiveBySlackUser: jest.fn().mockResolvedValue(targetJd),
  };
  const buildProfile = {
    execute: jest.fn().mockResolvedValue({
      result: profile,
      modelUsed: 'codex-cli',
      agentRunId: 88,
    }),
  };
  const modelRouter = {
    route: jest.fn().mockResolvedValue({
      text: AUDIT_JSON,
      modelUsed: 'codex-cli',
      provider: 'CHATGPT',
    }),
  };
  const agentRunService = {
    execute: jest.fn(
      async ({
        run,
      }: {
        triggerType: TriggerType;
        run: () => Promise<{
          result: unknown;
          modelUsed: string;
          output: unknown;
        }>;
      }) => {
        const runResult = await run();
        return {
          result: runResult.result,
          modelUsed: runResult.modelUsed,
          agentRunId: 99,
        };
      },
    ),
  };
  const usecase = new AuditResumeUsecase(
    repository as never,
    targetJdRepository as never,
    buildProfile as never,
    modelRouter as never,
    agentRunService as never,
  );
  return {
    usecase,
    repository,
    targetJdRepository,
    buildProfile,
    modelRouter,
    agentRunService,
  };
};

describe('AuditResumeUsecase', () => {
  it('등록된 목표 공고와 함께 감사하고 jdSource를 반환한다', async () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const fixture = createFixture({
      targetJd: {
        id: 3,
        company: '이대리',
        role: '백엔드',
        jdText: 'NestJS 운영 경험 필수',
        createdAt,
      },
    });

    const outcome = await fixture.usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
    });

    expect(outcome.result.jdSource).toEqual({
      company: '이대리',
      role: '백엔드',
      registeredAt: createdAt.toISOString(),
    });
    expect(fixture.modelRouter.route.mock.calls[0][0].request.prompt).toContain(
      '[목표 공고] 이대리 / 백엔드',
    );
    expect(
      fixture.targetJdRepository.findActiveBySlackUser,
    ).toHaveBeenCalledWith('U1', 30);
  });

  it('등록된 목표 공고가 없으면 이력서만 감사한다', async () => {
    const fixture = createFixture({ targetJd: null });

    const outcome = await fixture.usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
    });

    expect(outcome.result.jdSource).toBeNull();
    expect(
      fixture.modelRouter.route.mock.calls[0][0].request.prompt,
    ).not.toContain('[목표 공고]');
  });

  it('등록된 공고가 없으면 모델이 낸 jdFindings 를 버린다', async () => {
    // 프롬프트는 공고가 없으면 빈 배열을 요구하지만, 모델이 계약을 어기면 존재하지 않는
    // 공고의 요구사항이 정상 결과처럼 화면에 오른다.
    const fixture = createFixture({ targetJd: null });
    fixture.modelRouter.route.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: '감사 결과',
        items: [],
        jdFindings: [
          {
            requirement: '있지도 않은 공고의 요구',
            priority: 'MUST',
            status: 'MISSING',
            quote: '',
            why: '모델이 지어냈다.',
          },
        ],
        rejectionRisks: [],
      }),
      modelUsed: 'codex-cli',
      provider: 'CHATGPT',
    });

    const outcome = await fixture.usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
    });

    expect(outcome.result.jdFindings).toEqual([]);
    expect(outcome.result.jdSource).toBeNull();
  });

  it('성과가 0건이면 모델을 호출하지 않고 빈 결과를 반환한다', async () => {
    const fixture = createFixture({
      profile: { ...PROFILE, accomplishments: [] },
      targetJd: null,
    });

    const outcome = await fixture.usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.AUTOPILOT_RESUME_AUDIT_CRON,
    });

    expect(outcome.result).toEqual({
      verdict: '판정할 성과가 없습니다.',
      items: [],
      highlights: [],
      jdFindings: [],
      rejectionRisks: [],
      guard: {
        demotedTitles: [],
        droppedTitles: [],
        unjudgedTitles: [],
        outOfWindowTitles: [],
        forcedMissing: [],
        rewriteMissing: [],
        droppedHighlights: [],
      },
      jdSource: null,
    });
    expect(fixture.modelRouter.route).not.toHaveBeenCalled();
    expect(fixture.agentRunService.execute.mock.calls[0][0].triggerType).toBe(
      TriggerType.AUTOPILOT_RESUME_AUDIT_CRON,
    );
  });

  // 창 선택이 usecase 에 실제로 연결됐는지 — 모델 입력은 줄고 결과는 전체를 유지해야 한다.
  // 둘 중 하나만 되면 각각 다른 사고가 난다: 입력이 안 줄면 타임아웃이 그대로고, 결과가
  // 줄면 범위 밖 성과가 화면에서 조용히 사라진다.
  it('성과가 상한을 넘으면 모델 입력만 줄이고 결과에는 전체 성과를 남긴다', async () => {
    const manyAccomplishments = Array.from({ length: 70 }, (_, index) => ({
      ...PROFILE.accomplishments[0],
      title: `성과 ${index + 1}`,
    }));
    const fixture = createFixture({
      profile: { ...PROFILE, accomplishments: manyAccomplishments },
    });

    const outcome = await fixture.usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.AUTOPILOT_RESUME_AUDIT_CRON,
    });

    const prompt = fixture.modelRouter.route.mock.calls[0][0].request
      .prompt as string;
    // 판정 대상([성과] 절의 `### 제목`)은 창 크기를 넘지 않는다. 창이 날짜로 굴러 마지막
    // 구간은 30 보다 작을 수 있으므로 정확한 수가 아니라 상한과 합으로 검증한다.
    const judgedHeadings = prompt.match(/^### /gm) ?? [];
    expect(judgedHeadings.length).toBeLessThanOrEqual(30);
    expect(prompt).toContain('[이번 회차 범위]');
    // 보여준 것 + 범위 밖 = 전체. 어느 쪽으로도 새거나 겹치지 않는다.
    expect(
      judgedHeadings.length + outcome.result.guard.outOfWindowTitles.length,
    ).toBe(70);
    // 결과에는 70 건이 전부 남는다 — 범위 밖도 UNJUDGED 로 화면에 유지된다.
    expect(outcome.result.items).toHaveLength(70);
    // 범위 밖은 가드 경고 대상이 아니다(하류 hasGuardConcern 이 매일 울지 않게).
    for (const title of outcome.result.guard.outOfWindowTitles) {
      expect(outcome.result.guard.unjudgedTitles).not.toContain(title);
    }
  });

  it('성과가 상한 이하면 범위 절도 전체 목록도 붙이지 않는다 — 종전 프롬프트 그대로', async () => {
    const fixture = createFixture({});

    await fixture.usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.AUTOPILOT_RESUME_AUDIT_CRON,
    });

    const prompt = fixture.modelRouter.route.mock.calls[0][0].request
      .prompt as string;
    expect(prompt).not.toContain('[이번 회차 범위]');
    expect(prompt).not.toContain('[이력서 전체 성과 목록');
  });
});
