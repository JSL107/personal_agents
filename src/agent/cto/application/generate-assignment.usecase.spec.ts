import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
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
  let usecase: GenerateAssignmentUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 21 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 21,
      };
    });
    agentRunServiceFindLatest = jest.fn().mockResolvedValue({
      id: 99,
      output: { plan: pmPlan },
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
      output: { plan: pmPlan },
      endedAt: new Date(Date.now() - STALENESS_THRESHOLD_MS - 60_000),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      ctoErrorCode: CtoErrorCode.STALE_PM_RUN,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('직전 PM output 형식이 객체 아니면 NO_ASSIGNABLE_TASKS 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: 'not-an-object',
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CtoException,
    );
  });

  it('PM output.plan 이 DailyPlan 스키마 안 맞으면 NO_ASSIGNABLE_TASKS 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: { plan: { not: 'a plan' } },
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CtoException,
    );
  });

  it('assignableTaskIds 비어있으면 NO_ASSIGNABLE_TASKS 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: { plan: { ...pmPlan, assignableTaskIds: [] } },
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
        plan: { ...pmPlan, assignableTaskIds: ['t:morning-1', 't:ghost'] },
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
});
