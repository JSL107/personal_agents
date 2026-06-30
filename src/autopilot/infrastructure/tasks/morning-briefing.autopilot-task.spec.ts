import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { MorningBriefingAutopilotTask } from './morning-briefing.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

const mockTask = {
  id: 'task-1',
  title: '작업1',
  source: 'github' as const,
  subtasks: [],
  isCriticalPath: false,
};

const basePlan = {
  topPriority: mockTask,
  morning: [mockTask],
  afternoon: [],
  blocker: null,
  estimatedHours: 4,
  reasoning: '테스트 계획',
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
};

describe('MorningBriefingAutopilotTask', () => {
  it('id 는 morning-briefing', () => {
    const humanizeService = { humanize: jest.fn() };
    const task = new MorningBriefingAutopilotTask({} as never, humanizeService as any);
    expect(task.id).toBe('morning-briefing');
  });

  it('PM 계획 성공 시 summaryText 반환(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [],
      },
      modelUsed: 'codex-cli',
      agentRunId: 10,
    });
    const humanizeService = {
      humanize: jest.fn().mockResolvedValue({ reasoning: '테스트 계획', analysisReasoning: '' }),
    };
    const task = new MorningBriefingAutopilotTask({ execute } as never, humanizeService as any);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toBeTruthy();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', tasksText: '' }),
    );
  });

  it('plan 을 윤문하고 대기 섹션을 summaryText 에 합성한다', async () => {
    const outcome = {
      result: {
        plan: basePlan,
        sources: [],
        waitingItems: [{ title: 'PR1', url: 'https://x/1', reason: '머지만 남음' }],
      },
      modelUsed: 'chatgpt',
      agentRunId: 1,
    };
    const generateDailyPlan = { execute: jest.fn().mockResolvedValue(outcome) };
    const humanizeService = {
      humanize: jest.fn().mockResolvedValue({ reasoning: '윤문', analysisReasoning: '윤문' }),
    };
    const task = new MorningBriefingAutopilotTask(
      generateDailyPlan as any,
      humanizeService as any,
    );
    const result = await task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-06-30' });
    expect(result.summaryText).toContain('대기 중');
    expect(result.summaryText).toContain('머지만 남음');
  });

  it('EMPTY_TASKS_INPUT 면 안내문 반환(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message: '없음',
        status: DomainStatus.UNPROCESSABLE_ENTITY,
      }),
    );
    const humanizeService = { humanize: jest.fn() };
    const task = new MorningBriefingAutopilotTask(
      { execute } as never,
      humanizeService as any,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('오늘 자동 수집된 할 일이 없습니다');
  });

  it('그 외 에러는 throw', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const humanizeService = { humanize: jest.fn() };
    const task = new MorningBriefingAutopilotTask(
      { execute } as never,
      humanizeService as any,
    );
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });
});
