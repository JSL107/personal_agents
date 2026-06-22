import { RunRetroAutopilotTask } from './run-retro.autopilot-task';

describe('RunRetroAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-22' };

  it('통계 있으면 slackText 반환(skip=false)', async () => {
    const agentRunService = {
      aggregateRunStats: jest.fn().mockResolvedValue([
        {
          agentType: 'PM',
          total: 3,
          failed: 0,
          failRate: 0,
          avgDurationMs: 1000,
        },
      ]),
    };
    const task = new RunRetroAutopilotTask(agentRunService as never);

    const result = await task.run(context);

    expect(agentRunService.aggregateRunStats).toHaveBeenCalledWith({
      sinceDays: 7,
    });
    expect(result.skip).toBe(false);
    expect(result.slackText).toContain('주간 실행 회고');
  });

  it('통계 0건이면 skip=true (빈 알림 방지)', async () => {
    const agentRunService = {
      aggregateRunStats: jest.fn().mockResolvedValue([]),
    };
    const task = new RunRetroAutopilotTask(agentRunService as never);

    const result = await task.run(context);

    expect(result.skip).toBe(true);
    expect(result.slackText).toBeUndefined();
  });
});
