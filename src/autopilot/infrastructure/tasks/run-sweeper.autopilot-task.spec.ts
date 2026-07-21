import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { RunSweeperAutopilotTask } from './run-sweeper.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-01' };

describe('RunSweeperAutopilotTask', () => {
  it('좀비 0건이면 skip', async () => {
    const service = { sweepZombies: jest.fn().mockResolvedValue(0) };
    const task = new RunSweeperAutopilotTask(
      service as unknown as AgentRunService,
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(service.sweepZombies).toHaveBeenCalledWith({
      olderThanMinutes: 30,
    });
  });

  it('좀비 N건이면 요약 발송', async () => {
    const service = { sweepZombies: jest.fn().mockResolvedValue(3) };
    const task = new RunSweeperAutopilotTask(
      service as unknown as AgentRunService,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('3건');
  });
});
