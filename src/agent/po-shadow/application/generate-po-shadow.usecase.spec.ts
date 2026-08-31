import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { PoShadowException } from '../domain/po-shadow.exception';
import { PoShadowContext, PoShadowReport } from '../domain/po-shadow.type';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import { PO_SHADOW_OUTPUT_SCHEMA } from '../domain/prompt/po-shadow.schema';
import { GeneratePoShadowUsecase } from './generate-po-shadow.usecase';
import { PoShadowContextCollector } from './po-shadow-context.collector';

const buildTask = ({
  id,
  title,
  source,
}: {
  id: string;
  title: string;
  source: TaskItem['source'];
}): TaskItem => ({
  id,
  title,
  source,
  subtasks: [],
  isCriticalPath: true,
});

const githubTask = buildTask({
  id: 'acme/app#264',
  title: '업로드 개선',
  source: 'GITHUB',
});
const userInputTask = buildTask({
  id: 'user:release-check',
  title: '릴리즈 체크',
  source: 'USER_INPUT',
});

const buildPlan = (planTask: TaskItem): DailyPlan => ({
  topPriority: planTask,
  varianceAnalysis: {
    rolledOverTasks: [],
    analysisReasoning: '(이월 없음)',
  },
  morning: [planTask],
  afternoon: [],
  blocker: null,
  estimatedHours: 6,
  reasoning: 'r',
});

const quietPlan = buildPlan(userInputTask);
const mismatchPlan = buildPlan(githubTask);

const emptyContext = (): PoShadowContext => ({
  assignedTasks: { issues: [], pullRequests: [] },
  waitingItems: [],
  activePullRequests: [],
  newMentions: [],
  notionTasks: [],
  failedRunsToday: [],
  mergedPullRequests: [],
  mergedLookupAvailable: true,
  degradedSources: [],
});

const mismatchContext = (): PoShadowContext => ({
  assignedTasks: {
    issues: [],
    pullRequests: [
      {
        number: 264,
        title: '업로드 개선',
        repo: 'acme/app',
        url: 'https://github.com/acme/app/pull/264',
        draft: false,
        updatedAt: '2026-08-19T00:00:00.000Z',
        requestedReviewers: [],
        isApproved: false,
      },
    ],
  },
  waitingItems: [
    {
      title: '업로드 개선',
      url: 'https://github.com/acme/app/pull/264',
      reason: '리뷰 0건 · 마지막 활동 3일 전',
    },
  ],
  activePullRequests: [],
  newMentions: [],
  notionTasks: [],
  failedRunsToday: [],
  mergedPullRequests: [],
  mergedLookupAvailable: true,
  degradedSources: [],
});

const modelReport = (findings: PoShadowReport['findings']): PoShadowReport => ({
  schemaVersion: 2,
  quiet: false,
  headline: '#264 업로드 차단부터 해소하세요.',
  findings,
  purposeConflict: null,
  factSummary: [],
  droppedFindingCount: 0,
  degradedSources: [],
});

describe('GeneratePoShadowUsecase', () => {
  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let agentRunServiceFindLatest: jest.Mock;
  let contextCollectorCollect: jest.Mock;
  let usecase: GeneratePoShadowUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 11 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 11,
      };
    });
    agentRunServiceFindLatest = jest.fn().mockResolvedValue({
      id: 99,
      output: quietPlan,
      endedAt: new Date(),
    });
    contextCollectorCollect = jest.fn().mockResolvedValue(emptyContext());

    usecase = new GeneratePoShadowUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      {
        execute: agentRunServiceExecute,
        findLatestSucceededRun: agentRunServiceFindLatest,
      } as unknown as AgentRunService,
      {
        collect: contextCollectorCollect,
      } as unknown as PoShadowContextCollector,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(
        modelReport([
          {
            factIds: ['stalled:acme/app#264'],
            point: '#264 업로드 작업이 멈췄습니다.',
            suggestion: '리뷰어를 지정하세요.',
          },
        ]),
      ),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);
  });

  it('직전 PM run이 없으면 사용자 범위 조회 후 NO_RECENT_PLAN 예외를 반환한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue(null);

    await expect(
      usecase.execute({ extraContext: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      poShadowErrorCode: PoShadowErrorCode.NO_RECENT_PLAN,
    });
    expect(agentRunServiceFindLatest).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      slackUserId: 'U1',
    });
    expect(contextCollectorCollect).not.toHaveBeenCalled();
  });

  it('직전 PM output이 DailyPlan이 아니면 수집 전에 NO_RECENT_PLAN 예외를 반환한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: { not: 'a plan' },
      endedAt: new Date(),
    });

    await expect(
      usecase.execute({ extraContext: '', slackUserId: 'U1' }),
    ).rejects.toBeInstanceOf(PoShadowException);
    expect(contextCollectorCollect).not.toHaveBeenCalled();
  });

  it('freshness를 강제하면 18시간 초과 PM plan은 수집 전에 STALE_PLAN 예외를 반환한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: quietPlan,
      endedAt: new Date(Date.now() - 19 * 60 * 60 * 1000),
    });

    await expect(
      usecase.execute({
        extraContext: '',
        slackUserId: 'U1',
        enforcePlanFreshness: true,
      }),
    ).rejects.toMatchObject({
      poShadowErrorCode: PoShadowErrorCode.STALE_PLAN,
    });
    expect(contextCollectorCollect).not.toHaveBeenCalled();
    expect(agentRunServiceExecute).not.toHaveBeenCalled();
  });

  it('freshness를 강제하지 않으면 18시간 초과 PM plan도 정상 검토한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: quietPlan,
      endedAt: new Date(Date.now() - 19 * 60 * 60 * 1000),
    });

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(result.result.quiet).toBe(true);
    expect(contextCollectorCollect).toHaveBeenCalledTimes(1);
  });

  // 사용자가 상황을 직접 적어 보냈는데 사실표가 조용하다는 이유로 모델을 건너뛰면,
  // 그 말은 evidence 에만 저장되고 답은 "계획대로 진행 중" 으로 나간다.
  it('어긋남이 없어도 사용자가 상황을 적어 보내면 검토한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: quietPlan,
      endedAt: new Date('2026-08-19T03:00:00.000Z'),
    });

    await usecase.execute({
      extraContext: '릴리즈가 오늘로 당겨졌습니다',
      slackUserId: 'U1',
    });

    expect(modelRouter.route).toHaveBeenCalled();
  });

  it('어긋남이 없으면 사실을 수집하고 모델 없이 deterministic v2를 원장에 기록한다', async () => {
    const planEndedAt = new Date('2026-08-19T03:00:00.000Z');
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: quietPlan,
      endedAt: planEndedAt,
    });

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(contextCollectorCollect).toHaveBeenCalledWith({
      slackUserId: 'U1',
      planEndedAt,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(result).toEqual({
      agentRunId: 11,
      modelUsed: 'deterministic',
      result: {
        schemaVersion: 2,
        quiet: true,
        headline: '계획대로 진행 중',
        findings: [],
        purposeConflict: null,
        factSummary: ['릴리즈 체크 — 외부 상태로 자동 확인 불가'],
        droppedFindingCount: 0,
        degradedSources: [],
      },
    });
    expect(agentRunServiceExecute).toHaveBeenCalledTimes(1);
  });

  it('quiet evidence에 직전 계획과 코드 생성 사실표를 모두 담는다', async () => {
    await usecase.execute({ extraContext: '', slackUserId: 'U1' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.PO_SHADOW);
    expect(call.triggerType).toBe(TriggerType.SLACK_COMMAND_PO_SHADOW);
    expect(call.inputSnapshot).toMatchObject({
      slackUserId: 'U1',
      sourcePlanAgentRunId: 99,
      extraContextLength: 0,
    });
    expect(call.evidence).toEqual([
      {
        sourceType: 'PRIOR_DAILY_PLAN',
        sourceId: '99',
        payload: expect.objectContaining({ plan: quietPlan }),
      },
      {
        sourceType: 'PO_SHADOW_FACT_TABLE',
        sourceId: '99',
        payload: [
          expect.objectContaining({
            id: 'unverifiable:user:release-check',
            kind: 'PLANNED_UNVERIFIABLE',
          }),
        ],
      },
    ]);
  });

  it('어긋남이 있으면 사실표 prompt와 v2 output schema로 모델을 호출한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: mismatchPlan,
      endedAt: new Date(),
    });
    contextCollectorCollect.mockResolvedValue(mismatchContext());

    const result = await usecase.execute({
      extraContext: 'v2 릴리즈 직전',
      slackUserId: 'U1',
    });

    const routeInput = modelRouter.route.mock.calls[0][0];
    expect(routeInput.request.outputSchema).toBe(PO_SHADOW_OUTPUT_SCHEMA);
    expect(routeInput.request.prompt).toContain('[직전 PM plan');
    expect(routeInput.request.prompt).toContain('[정오 사실표]');
    expect(routeInput.request.prompt).toContain('stalled:acme/app#264');
    expect(routeInput.request.prompt).toContain('업로드 개선');
    expect(routeInput.request.prompt).toContain(
      '리뷰 0건 · 마지막 활동 3일 전',
    );
    expect(routeInput.request.prompt).toContain('[추가 컨텍스트]');
    expect(routeInput.request.prompt).toContain('v2 릴리즈 직전');
    expect(result.result).toMatchObject({
      schemaVersion: 2,
      quiet: false,
      droppedFindingCount: 0,
      degradedSources: [],
      factSummary: ['업로드 개선 — 리뷰 0건 · 마지막 활동 3일 전'],
    });
  });

  it('모델 finding의 무효 근거는 제거하고 유효 근거만 사람용 요약으로 대응시킨다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: mismatchPlan,
      endedAt: new Date(),
    });
    contextCollectorCollect.mockResolvedValue(mismatchContext());
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(
        modelReport([
          {
            factIds: ['invented:only'],
            point: '근거가 없는 주장입니다.',
            suggestion: '근거 없이 처리하세요.',
          },
          {
            factIds: ['invented:partial', 'stalled:acme/app#264'],
            point: '#264 업로드 작업이 멈췄습니다.',
            suggestion: '리뷰어를 지정하세요.',
          },
        ]),
      ),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(result.result.findings).toEqual([
      {
        factIds: ['stalled:acme/app#264'],
        point: '#264 업로드 작업이 멈췄습니다.',
        suggestion: '리뷰어를 지정하세요.',
      },
    ]);
    expect(result.result.factSummary).toEqual([
      '업로드 개선 — 리뷰 0건 · 마지막 활동 3일 전',
    ]);
    expect(result.result.droppedFindingCount).toBe(1);
  });

  it('한 finding이 여러 사실을 인용하면 첫 근거만 보이고 나머지는 건수로 접는다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: mismatchPlan,
      endedAt: new Date(),
    });
    contextCollectorCollect.mockResolvedValue({
      ...mismatchContext(),
      newMentions: [
        {
          channelId: 'C1',
          channelName: 'release',
          channelType: 'public_channel',
          authorUserId: 'U2',
          ts: '1770000000.000100',
          text: '배포 일정 확인 요청',
          permalink: 'https://slack.example/archives/C1/p1770000000000100',
        },
      ],
    });
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(
        modelReport([
          {
            factIds: ['stalled:acme/app#264', 'mention:C1:1770000000.000100'],
            point: 'PR 차단과 새 요청이 겹쳤습니다.',
            suggestion: '리뷰와 배포 일정을 함께 정리하세요.',
          },
        ]),
      ),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(result.result.factSummary).toEqual([
      '업로드 개선 — 리뷰 0건 · 마지막 활동 3일 전 (외 1건)',
    ]);
    expect(result.result.factSummary[0]).not.toContain('stalled:');
    expect(result.result.factSummary[0]).not.toContain('mention:C1');
  });

  // UNPLANNED_ASSIGNED 의 detail("계획에 없는 담당 항목")은 근거가 아니라 판정이고,
  // finding 이 이미 같은 말을 한다 — 근거 줄에 다시 실으면 "근거: (방금 한 말)" 이 된다.
  it('계획 밖 담당 항목의 근거는 판정을 반복하지 않고 제목만 남긴다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: mismatchPlan,
      endedAt: new Date(),
    });
    const context = mismatchContext();
    context.assignedTasks?.pullRequests.push({
      number: 999,
      title: '캐시 정리',
      repo: 'acme/app',
      url: 'https://github.com/acme/app/pull/999',
      draft: false,
      updatedAt: '2026-08-19T00:00:00.000Z',
      requestedReviewers: [],
      isApproved: false,
    });
    contextCollectorCollect.mockResolvedValue(context);
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(
        modelReport([
          {
            factIds: ['unplanned:acme/app#999'],
            point: '캐시 정리가 계획에 없습니다.',
            suggestion: '오늘 할지 정하세요.',
          },
        ]),
      ),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(result.result.factSummary).toEqual(['캐시 정리']);
    expect(result.result.factSummary[0]).not.toContain('계획에 없는');
  });

  it('모든 모델 finding이 제거되면 전체 사실 요약을 보존한다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: mismatchPlan,
      endedAt: new Date(),
    });
    contextCollectorCollect.mockResolvedValue(mismatchContext());
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(
        modelReport([
          {
            factIds: ['invented:only'],
            point: '근거가 없는 주장입니다.',
            suggestion: '근거 없이 처리하세요.',
          },
        ]),
      ),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(result.result.findings).toEqual([]);
    expect(result.result.factSummary).toEqual([
      '업로드 개선 — 리뷰 0건 · 마지막 활동 3일 전',
    ]);
    expect(result.result.droppedFindingCount).toBe(1);
  });

  it('triggerType과 extra context evidence를 그대로 원장에 전달한다', async () => {
    await usecase.execute({
      extraContext: '  릴리즈 직전  ',
      slackUserId: 'U1',
      triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
    });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.triggerType).toBe(TriggerType.AUTOPILOT_PO_SHADOW_CRON);
    expect(call.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceType: 'PRIOR_DAILY_PLAN' }),
        expect.objectContaining({ sourceType: 'PO_SHADOW_FACT_TABLE' }),
        {
          sourceType: 'SLACK_COMMAND_PO_SHADOW',
          sourceId: 'U1',
          payload: { extraContext: '릴리즈 직전' },
        },
      ]),
    );
  });

  it('assignedTasks가 null이면 GitHub 계획을 미확인 이상으로 만들거나 모델을 호출하지 않는다', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: mismatchPlan,
      endedAt: new Date(),
    });
    contextCollectorCollect.mockResolvedValue({
      ...emptyContext(),
      assignedTasks: null,
    });

    const result = await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
    });

    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({
      quiet: true,
      findings: [],
      factSummary: [],
    });
    expect(result.modelUsed).toBe('deterministic');
  });
});
