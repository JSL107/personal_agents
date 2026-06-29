import { WeeklySummaryAutopilotTask } from './weekly-summary.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

describe('WeeklySummaryAutopilotTask', () => {
  it('id 는 weekly-summary', () => {
    expect(
      new WeeklySummaryAutopilotTask({} as never, {} as never, {} as never).id,
    ).toBe('weekly-summary');
  });

  it('이번 주 PM run 0건 → graceful skip 안내(skip=false, worklog/CEO 미호출)', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const worklogExecute = jest.fn();
    const ceoExecute = jest.fn();
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: ceoExecute } as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('skip');
    expect(worklogExecute).not.toHaveBeenCalled();
    expect(ceoExecute).not.toHaveBeenCalled();
    expect(findRecentSucceededRuns).toHaveBeenCalledWith(
      expect.objectContaining({ sinceDays: 7 }),
    );
  });
});
