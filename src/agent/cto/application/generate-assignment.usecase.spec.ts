import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { ConversationContext } from '../../../router/domain/conversation-context.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { CtoException } from '../domain/cto.exception';
import { AssignmentOutput } from '../domain/cto.type';
import { CtoErrorCode } from '../domain/cto-error-code.enum';
import { GenerateAssignmentUsecase } from './generate-assignment.usecase';

// staleness threshold 18h — usecase 상수와 동일.
const STALENESS_THRESHOLD_MS = 18 * 60 * 60 * 1000;

const task = (title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `t:${title}`,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
});

const pmPlan: DailyPlan = {
  topPriority: task('CTO worker plan', { id: 't:top', isCriticalPath: true }),
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
  morning: [task('Router refactor', { id: 't:morning-1' })],
  afternoon: [
    task('Schema 마이그레이션', { id: 't:afternoon-1' }),
    task('테스트 보강', { id: 't:afternoon-2' }),
  ],
  blocker: null,
  estimatedHours: 6,
  reasoning: 'CTO 분배 후보 plan',
  assignableTaskIds: ['t:morning-1', 't:afternoon-1', 't:afternoon-2'],
};

const validAssignment: AssignmentOutput = {
  assignments: [
    {
      taskId: 't:morning-1',
      taskTitle: 'Router refactor',
      beAssignment: AgentType.BE,
      priority: 1,
      reasoning: 'BE 진입 worker',
      confidence: 0.9,
    },
    {
      taskId: 't:afternoon-1',
      taskTitle: 'Schema 마이그레이션',
      beAssignment: AgentType.BE_SCHEMA,
      priority: 2,
      reasoning: 'Prisma schema 변경',
      confidence: 0.8,
    },
  ],
  unassignedTasks: [
    {
      taskId: 't:afternoon-2',
      taskTitle: '테스트 보강',
      reason: 'BE/BE_TEST 경계 모호',
    },
  ],
  ctoSummary: '2건 분배 / 1건 보류',
};

describe('GenerateAssignmentUsecase', () => {
  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let agentRunServiceFindLatest: jest.Mock;
  let updateInputSnapshot: jest.Mock;
  let usecase: GenerateAssignmentUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    updateInputSnapshot = jest.fn();
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({
        agentRunId: 21,
        updateInputSnapshot,
      });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 21,
      };
    });
    agentRunServiceFindLatest = jest.fn().mockResolvedValue({
      id: 99,
      output: pmPlan,
      endedAt: new Date(Date.now() - 60_000),
    });

    usecase = new GenerateAssignmentUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      {
        execute: agentRunServiceExecute,
        findLatestSucceededRun: agentRunServiceFindLatest,
      } as unknown as AgentRunService,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validAssignment),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    } satisfies CompletionResponse);
  });

  it('직전 PM run 없으면 NO_RECENT_PM_RUN 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue(null);
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      ctoErrorCode: CtoErrorCode.NO_RECENT_PM_RUN,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('직전 PM run 이 staleness threshold (18h) 초과면 STALE_PM_RUN 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: pmPlan,
      endedAt: new Date(Date.now() - STALENESS_THRESHOLD_MS - 60_000),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      ctoErrorCode: CtoErrorCode.STALE_PM_RUN,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('직전 PM output 형식이 객체 아니면 INVALID_PLAN_OUTPUT 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: 'not-an-object',
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      ctoErrorCode: CtoErrorCode.INVALID_PLAN_OUTPUT,
    });
  });

  it('PM output이 DailyPlan 스키마에 맞지 않으면 INVALID_PLAN_OUTPUT 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: { not: 'a plan' },
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      ctoErrorCode: CtoErrorCode.INVALID_PLAN_OUTPUT,
    });
  });

  it('assignableTaskIds 비어있으면 NO_ASSIGNABLE_TASKS 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: { ...pmPlan, assignableTaskIds: [] },
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      ctoErrorCode: CtoErrorCode.NO_ASSIGNABLE_TASKS,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('모델 응답을 AssignmentOutput 으로 파싱해 반환', async () => {
    const outcome = await usecase.execute({ slackUserId: 'U1' });
    expect(outcome.result).toEqual(validAssignment);
    expect(outcome.modelUsed).toBe('claude-cli');
    expect(outcome.agentRunId).toBe(21);
  });

  it('AgentRunService 에 CTO + SLACK_COMMAND_ASSIGN + PM_PLAN evidence 전달', async () => {
    await usecase.execute({ slackUserId: 'U1' });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.CTO);
    expect(call.triggerType).toBe('SLACK_COMMAND_ASSIGN');
    expect(call.inputSnapshot).toMatchObject({
      slackUserId: 'U1',
      dailyPlanAgentRunId: 99,
      assignableCount: 3,
    });
    expect(call.evidence).toEqual([
      expect.objectContaining({
        sourceType: 'PM_PLAN',
        sourceId: '99',
        payload: expect.objectContaining({ assignableCount: 3 }),
      }),
    ]);
  });

  it('triggerType을 지정하면 AgentRunService에 그대로 전달한다', async () => {
    await usecase.execute({
      slackUserId: 'U1',
      triggerType: TriggerType.AUTOPILOT_ASSIGN_CRON,
    });

    expect(agentRunServiceExecute.mock.calls[0][0].triggerType).toBe(
      TriggerType.AUTOPILOT_ASSIGN_CRON,
    );
  });

  it('prompt 에 PM reasoning + 후보 task id/title 모두 포함', async () => {
    await usecase.execute({ slackUserId: 'U1' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[PM plan reasoning]');
    expect(promptArg).toContain('CTO 분배 후보 plan');
    expect(promptArg).toContain('id=t:morning-1');
    expect(promptArg).toContain('title=Router refactor');
    expect(promptArg).toContain('id=t:afternoon-1');
    expect(promptArg).toContain('id=t:afternoon-2');
    expect(promptArg).toContain('BE / BE_SCHEMA / BE_TEST');
  });

  it('assignableTaskIds 에 plan 안에 없는 id 있으면 graceful — title 자리표시자', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: {
        ...pmPlan,
        assignableTaskIds: ['t:morning-1', 't:ghost'],
      },
      endedAt: new Date(),
    });
    await usecase.execute({ slackUserId: 'U1' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('id=t:ghost');
    expect(promptArg).toContain('(plan 안 매핑 안 된 task: t:ghost)');
  });

  it('dailyPlanAgentRunId 명시 지정해도 본 step 자동 조회로 fallback (warn)', async () => {
    await usecase.execute({ slackUserId: 'U1', dailyPlanAgentRunId: 12345 });
    // findLatestSucceededRun 만 호출 — 명시 id 로직 미적용.
    expect(agentRunServiceFindLatest).toHaveBeenCalledTimes(1);
    expect(agentRunServiceFindLatest).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      slackUserId: 'U1',
    });
  });

  it('모델 응답이 schema 와 안 맞으면 CtoException 으로 throw', async () => {
    modelRouter.route.mockResolvedValue({
      text: '{"assignments": "not-an-array"}',
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CtoException,
    );
  });

  it('conversationContext.userInstruction 있으면 prompt 맨 앞에 [사용자 지시] 섹션 포함', async () => {
    const conversationContext: ConversationContext = {
      userInstruction: '백엔드 성능 이슈 우선 배정해줘',
    };
    await usecase.execute({ slackUserId: 'U1', conversationContext });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[사용자 지시');
    expect(promptArg).toContain('백엔드 성능 이슈 우선 배정해줘');
    // prompt 최상단에 위치 — [PM plan reasoning] 보다 앞에 나와야 함.
    expect(promptArg.indexOf('[사용자 지시')).toBeLessThan(
      promptArg.indexOf('[PM plan reasoning]'),
    );
  });

  it('conversationContext 없으면 prompt 에 [사용자 지시] 섹션 미포함 (회귀)', async () => {
    await usecase.execute({ slackUserId: 'U1' });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).not.toContain('[사용자 지시');
  });

  it('conversationContext 있어도 기존 분배 로직 동일 — 정상 AssignmentOutput 반환', async () => {
    const conversationContext: ConversationContext = {
      userInstruction: '성능 이슈 우선',
    };
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      conversationContext,
    });
    expect(outcome.result).toEqual(validAssignment);
  });

  // 자연어 재배정 — 사용자가 "3번은 테스트로" 처럼 일부만 고치려는 것이므로, 직전 분배를
  // 이어받지 않으면 언급하지 않은 task 의 배정까지 통째로 다시 뽑혀 흔들린다.
  describe('재배정 (직전 분배 이어받기)', () => {
    const priorCtoRun = {
      id: 77,
      output: validAssignment,
      endedAt: new Date(Date.now() - 30_000),
      // 이 CTO run 이 참조한 PM run — 현재 plan(#99)과 같아야 이어받는다.
      inputSnapshot: { slackUserId: 'U1', dailyPlanAgentRunId: 99 },
    };

    // findLatestSucceededRun 은 agentType 으로 PM/CTO 를 구분해 답한다.
    const mockRuns = ({ cto }: { cto: unknown }): void => {
      agentRunServiceFindLatest.mockImplementation(
        async ({ agentType }: { agentType: AgentType }) =>
          agentType === AgentType.CTO
            ? cto
            : {
                id: 99,
                output: pmPlan,
                endedAt: new Date(Date.now() - 60_000),
                inputSnapshot: { slackUserId: 'U1' },
              },
      );
    };

    it('사용자 지시가 있으면 직전 CTO 분배를 prompt 에 [직전 분배 결과] 로 싣는다', async () => {
      mockRuns({ cto: priorCtoRun });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로 바꿔줘' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('[직전 분배 결과');
      expect(promptArg).toContain('1. id=t:morning-1');
      expect(promptArg).toContain('Router refactor');
      expect(promptArg).toContain('보류 (unassignedTasks)');
      expect(promptArg).toContain('전체 재분배 금지');
    });

    // 사용자가 화면에서 본 순번과 prompt 순번이 어긋나면 "3번" 이 다른 task 를 가리킨다.
    it('직전 분배 항목은 화면과 같은 1-base 순번으로 싣는다', async () => {
      mockRuns({ cto: priorCtoRun });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '2번 바꿔줘' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('1. id=t:morning-1');
      expect(promptArg).toContain('2. id=t:afternoon-1');
    });

    // 지시 없는 재실행(슬래시 /assign, cron)까지 직전 결과를 물면 새 분배를 못 하게 된다.
    it('사용자 지시가 없으면 직전 CTO run 을 조회조차 하지 않는다', async () => {
      mockRuns({ cto: priorCtoRun });

      await usecase.execute({ slackUserId: 'U1' });

      expect(agentRunServiceFindLatest).toHaveBeenCalledTimes(1);
      expect(agentRunServiceFindLatest).toHaveBeenCalledWith({
        agentType: AgentType.PM,
        slackUserId: 'U1',
      });
      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 분배 결과');
    });

    it('직전 CTO run 이 없으면 새 분배로 진행', async () => {
      mockRuns({ cto: null });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 분배 결과');
    });

    // 다른 plan 을 보고 만든 표를 이어받으면 이번 plan 에 없는 task 가 섞인다.
    it('직전 CTO run 이 다른 PM plan 기반이면 이어받지 않는다', async () => {
      mockRuns({
        cto: {
          ...priorCtoRun,
          inputSnapshot: { slackUserId: 'U1', dailyPlanAgentRunId: 55 },
        },
      });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 분배 결과');
    });

    // 시각 비교로는 못 거르는 케이스: PM1 기반 CTO 가 도는 중에 PM2 가 만들어지면
    // 그 CTO 는 PM2 보다 늦게 끝난다. 참조한 plan id 로 대조해야 걸러진다.
    it('직전 CTO run 이 현재 plan 보다 늦게 끝났어도 참조 plan 이 다르면 이어받지 않는다', async () => {
      mockRuns({
        cto: {
          ...priorCtoRun,
          endedAt: new Date(),
          inputSnapshot: { slackUserId: 'U1', dailyPlanAgentRunId: 55 },
        },
      });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 분배 결과');
    });

    // 대조할 수 없으면 이어받지 않는다 (확실할 때만 재배정).
    it('직전 CTO run 의 inputSnapshot 에 참조 plan 이 없으면 이어받지 않는다', async () => {
      mockRuns({
        cto: { ...priorCtoRun, inputSnapshot: { slackUserId: 'U1' } },
      });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 분배 결과');
    });

    it('직전 CTO output 이 AssignmentOutput 형식이 아니면 graceful 하게 새 분배', async () => {
      mockRuns({ cto: { ...priorCtoRun, output: { not: 'an assignment' } } });

      const outcome = await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로' },
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 분배 결과');
      expect(outcome.result).toEqual(validAssignment);
    });

    it('재배정이면 inputSnapshot + evidence 에 직전 분배 run 을 남긴다', async () => {
      mockRuns({ cto: priorCtoRun });

      await usecase.execute({
        slackUserId: 'U1',
        conversationContext: { userInstruction: '3번은 테스트로' },
      });

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot).toMatchObject({
        priorAssignmentAgentRunId: 77,
      });
      expect(call.evidence).toContainEqual(
        expect.objectContaining({
          sourceType: 'PRIOR_ASSIGNMENT',
          sourceId: '77',
        }),
      );
    });
  });

  describe('계약 되먹임 재생성 — 빈 필수 필드 1회 재생성', () => {
    // run#2161 실측 형태 — 파싱은 통과하고 계약(missingField: ctoSummary)만 위반.
    const emptySummaryAssignment: AssignmentOutput = {
      ...validAssignment,
      ctoSummary: '',
    };

    const completionOf = (output: AssignmentOutput): CompletionResponse => ({
      text: JSON.stringify(output),
      modelUsed: 'claude-cli',
      provider: ModelProviderName.CLAUDE,
    });

    it('첫 응답의 ctoSummary 가 비면 위반을 되먹여 1회 재생성하고 재생성본을 채택', async () => {
      modelRouter.route
        .mockResolvedValueOnce(completionOf(emptySummaryAssignment))
        .mockResolvedValueOnce(completionOf(validAssignment));

      const outcome = await usecase.execute({ slackUserId: 'U1' });

      expect(modelRouter.route).toHaveBeenCalledTimes(2);
      const retryPrompt = modelRouter.route.mock.calls[1][0].request.prompt;
      expect(retryPrompt).toContain('[재생성 지시 — 직전 응답의 계약 위반]');
      expect(retryPrompt).toContain('missingField(ctoSummary)');
      expect(outcome.result.ctoSummary).toBe(validAssignment.ctoSummary);
    });

    it('재생성본도 같은 위반이면 첫 판을 채택한다 (재시도는 한 번뿐)', async () => {
      modelRouter.route.mockResolvedValue(completionOf(emptySummaryAssignment));

      const outcome = await usecase.execute({ slackUserId: 'U1' });

      expect(modelRouter.route).toHaveBeenCalledTimes(2);
      expect(outcome.result.ctoSummary).toBe('');
    });

    it('재생성 호출이 실패해도 첫 판으로 진행한다 — 재생성은 부가 시도', async () => {
      modelRouter.route
        .mockResolvedValueOnce(completionOf(emptySummaryAssignment))
        .mockRejectedValueOnce(new Error('쿼터 소진'));

      const outcome = await usecase.execute({ slackUserId: 'U1' });

      expect(outcome.result.ctoSummary).toBe('');
    });

    it('위반이 없으면 route 1회만 — 기존 경로 회귀 없음', async () => {
      await usecase.execute({ slackUserId: 'U1' });

      expect(modelRouter.route).toHaveBeenCalledTimes(1);
      expect(updateInputSnapshot).not.toHaveBeenCalled();
    });

    it('재생성이 일어나면 inputSnapshot 에 contractRetry 를 기록한다', async () => {
      modelRouter.route
        .mockResolvedValueOnce(completionOf(emptySummaryAssignment))
        .mockResolvedValueOnce(completionOf(validAssignment));

      await usecase.execute({ slackUserId: 'U1' });

      expect(updateInputSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          dailyPlanAgentRunId: 99,
          contractRetry: {
            firstViolations: ['missingField:ctoSummary'],
            adopted: 'retry',
          },
        }),
      );
    });

    it('재생성본을 채택하면 modelUsed 도 재생성 호출의 값을 쓴다', async () => {
      modelRouter.route
        .mockResolvedValueOnce({
          text: JSON.stringify(emptySummaryAssignment),
          modelUsed: 'first-model',
          provider: ModelProviderName.CLAUDE,
        } satisfies CompletionResponse)
        .mockResolvedValueOnce({
          text: JSON.stringify(validAssignment),
          modelUsed: 'retry-model',
          provider: ModelProviderName.CLAUDE,
        } satisfies CompletionResponse);

      const outcome = await usecase.execute({ slackUserId: 'U1' });

      expect(outcome.modelUsed).toBe('retry-model');
    });

    it('기록(updateInputSnapshot)이 실패해도 본체 결과는 반환된다', async () => {
      updateInputSnapshot.mockRejectedValue(new Error('DB 순단'));
      modelRouter.route
        .mockResolvedValueOnce(completionOf(emptySummaryAssignment))
        .mockResolvedValueOnce(completionOf(validAssignment));

      const outcome = await usecase.execute({ slackUserId: 'U1' });

      expect(outcome.result.ctoSummary).toBe(validAssignment.ctoSummary);
    });
  });
});
