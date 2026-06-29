import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { MorningBriefingAutopilotTask } from './morning-briefing.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

describe('MorningBriefingAutopilotTask', () => {
  it('id 는 morning-briefing', () => {
    const task = new MorningBriefingAutopilotTask({} as never);
    expect(task.id).toBe('morning-briefing');
  });

  it('PM 계획 성공 시 summaryText 반환(skip=false)', async () => {
    const mockTask = {
      id: 'task-1',
      title: '작업1',
      source: 'github' as const,
      subtasks: [],
      isCriticalPath: false,
    };
    const execute = jest.fn().mockResolvedValue({
      result: {
        plan: {
          topPriority: mockTask,
          morning: [mockTask],
          afternoon: [],
          blocker: null,
          estimatedHours: 4,
          reasoning: '테스트 계획',
          varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
        },
        sources: [],
      },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    });
    const task = new MorningBriefingAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', tasksText: '' }),
    );
  });

  it('EMPTY_TASKS_INPUT 면 안내문 반환(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message: '없음',
        status: DomainStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    const task = new MorningBriefingAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('오늘 자동 수집된 할 일이 없습니다');
  });

  it('그 외 에러는 throw', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const task = new MorningBriefingAutopilotTask({ execute } as never);
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });
});
