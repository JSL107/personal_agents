import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { DailyPlan, TaskItem } from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { SyncPlanUsecase } from './sync-plan.usecase';

const buildTask = (overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `user:${overrides.title ?? 'task'}`,
  title: overrides.title ?? 'task',
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
});

const buildPlan = (overrides: Partial<DailyPlan> = {}): DailyPlan => ({
  topPriority: buildTask(),
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
  morning: [],
  afternoon: [],
  blocker: null,
  estimatedHours: 5,
  reasoning: 'r',
  ...overrides,
});

describe('SyncPlanUsecase', () => {
  let agentRunFindLatest: jest.Mock;
  let createPreview: jest.Mock;
  let usecase: SyncPlanUsecase;

  beforeEach(() => {
    agentRunFindLatest = jest.fn();
    createPreview = jest.fn().mockImplementation(async (input) => ({
      id: 'preview-1',
      ...input,
      status: 'PENDING',
      expiresAt: new Date(),
      createdAt: new Date(),
      appliedAt: null,
      cancelledAt: null,
    }));

    usecase = new SyncPlanUsecase(
      {
        findLatestSucceededRun: agentRunFindLatest,
      } as unknown as AgentRunService,
      { execute: createPreview } as unknown as CreatePreviewUsecase,
    );
  });

  it('직전 PM run 없으면 NO_RECENT_PLAN', async () => {
    agentRunFindLatest.mockResolvedValue(null);
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      pmAgentErrorCode: PmAgentErrorCode.NO_RECENT_PLAN,
    });
  });

  it('직전 output 이 DailyPlan schema 아니면 NO_RECENT_PLAN', async () => {
    agentRunFindLatest.mockResolvedValue({
      id: 1,
      output: { not: 'a plan' },
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      pmAgentErrorCode: PmAgentErrorCode.NO_RECENT_PLAN,
    });
  });

  it('GITHUB/NOTION + subtasks 있는 후보가 없으면 NO_WRITE_BACK_CANDIDATES', async () => {
    agentRunFindLatest.mockResolvedValue({
      id: 1,
      output: buildPlan({
        topPriority: buildTask({ source: 'USER_INPUT' }),
        morning: [buildTask({ source: 'USER_INPUT' })],
      }),
      endedAt: new Date(),
    });
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toMatchObject({
      pmAgentErrorCode: PmAgentErrorCode.NO_WRITE_BACK_CANDIDATES,
    });
  });

  it('GITHUB task 후보 추출 + PreviewAction 생성', async () => {
    const githubTask = buildTask({
      id: 'foo/bar#34',
      title: 'PR review',
      source: 'GITHUB',
      subtasks: [{ title: 'sub 1', estimatedMinutes: 30 }],
    });
    agentRunFindLatest.mockResolvedValue({
      id: 1,
      output: buildPlan({ morning: [githubTask] }),
      endedAt: new Date(),
    });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.previewId).toBe('preview-1');
    expect(result.candidateCount).toBe(1);
    expect(result.previewText).toContain('GitHub Issue — PR review');
    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        kind: PREVIEW_KIND.PM_WRITE_BACK,
        payload: { tasks: [githubTask] },
        ttlMs: 60 * 60 * 1000,
      }),
    );
  });

  it('NOTION + GITHUB 다수 후보 모두 포함 — topPriority + morning + afternoon', async () => {
    const tp = buildTask({
      id: 'foo/bar#1',
      title: 'top',
      source: 'GITHUB',
      subtasks: [{ title: 'a', estimatedMinutes: 30 }],
      isCriticalPath: true,
    });
    const morningTask = buildTask({
      id: 'page-1',
      title: 'morning task',
      source: 'NOTION',
      subtasks: [{ title: 'b', estimatedMinutes: 60 }],
    });
    const afternoonTask = buildTask({
      id: 'page-2',
      title: 'afternoon task',
      source: 'NOTION',
      subtasks: [{ title: 'c', estimatedMinutes: 45 }],
    });
    agentRunFindLatest.mockResolvedValue({
      id: 1,
      output: buildPlan({
        topPriority: tp,
        morning: [morningTask],
        afternoon: [afternoonTask],
      }),
      endedAt: new Date(),
    });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.candidateCount).toBe(3);
    const payload = createPreview.mock.calls[0][0].payload as {
      tasks: TaskItem[];
    };
    expect(payload.tasks).toHaveLength(3);
  });

  it('USER_INPUT 만 있는 task 는 후보에서 제외', async () => {
    agentRunFindLatest.mockResolvedValue({
      id: 1,
      output: buildPlan({
        topPriority: buildTask({
          source: 'GITHUB',
          id: 'foo/bar#1',
          subtasks: [{ title: 'x', estimatedMinutes: 10 }],
        }),
        morning: [
          buildTask({
            source: 'USER_INPUT',
            subtasks: [{ title: 'y', estimatedMinutes: 10 }],
          }),
        ],
      }),
      endedAt: new Date(),
    });

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.candidateCount).toBe(1);
  });
});
