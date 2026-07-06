import { AgentRunStatRow } from '../../../agent-run/domain/port/agent-run.repository.port';
import { RunRetroAutopilotTask } from './run-retro.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-06' };

const makeService = (
  current: AgentRunStatRow[],
  previous: AgentRunStatRow[],
) => ({
  aggregateRunStats: jest
    .fn()
    .mockResolvedValueOnce(current) // 이번주 (sinceDays 7, untilDays 0)
    .mockResolvedValueOnce(previous), // 지난주 (sinceDays 14, untilDays 7)
});

describe('RunRetroAutopilotTask', () => {
  it('두 윈도우(이번주/지난주)를 조회한다', async () => {
    const service = makeService(
      [
        {
          agentType: 'PM',
          total: 11,
          failed: 0,
          failRate: 0,
          avgDurationMs: 40_000,
        },
      ],
      [
        {
          agentType: 'PM',
          total: 10,
          failed: 0,
          failRate: 0,
          avgDurationMs: 40_000,
        },
      ],
    );
    const task = new RunRetroAutopilotTask(service as never);

    await task.run(context);

    expect(service.aggregateRunStats).toHaveBeenNthCalledWith(1, {
      sinceDays: 7,
      untilDays: 0,
    });
    expect(service.aggregateRunStats).toHaveBeenNthCalledWith(2, {
      sinceDays: 14,
      untilDays: 7,
    });
  });

  it('정상이면 하트비트 반환(skip=false)', async () => {
    const service = makeService(
      [
        {
          agentType: 'PM',
          total: 11,
          failed: 0,
          failRate: 0,
          avgDurationMs: 40_000,
        },
      ],
      [
        {
          agentType: 'PM',
          total: 10,
          failed: 0,
          failRate: 0,
          avgDurationMs: 40_000,
        },
      ],
    );
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
  });

  it('이번주 0건 AND 지난주 0건이면 skip=true', async () => {
    const service = makeService([], []);
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.skip).toBe(true);
    expect(result.summaryText).toBeUndefined();
  });

  it('이번주 0건인데 지난주 있으면 전체침묵 경보(skip=false)', async () => {
    const service = makeService(
      [],
      [
        {
          agentType: 'PM',
          total: 45,
          failed: 0,
          failRate: 0,
          avgDurationMs: 40_000,
        },
      ],
    );
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('전체 침묵');
  });
});
