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
});
