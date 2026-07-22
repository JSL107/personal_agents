import { AgentRunStatRow } from '../../../agent-run/domain/port/agent-run.repository.port';
import { RunRetroAutopilotTask } from './run-retro.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-06' };

const makeService = (
  current: AgentRunStatRow[],
  previous: AgentRunStatRow[],
  chain: {
    roots?: number[];
    nodesByRoot?: Record<number, unknown[]>;
  } = {},
) => ({
  aggregateRunStats: jest
    .fn()
    .mockResolvedValueOnce(current) // 이번주 (sinceDays 7, untilDays 0)
    .mockResolvedValueOnce(previous), // 지난주 (sinceDays 14, untilDays 7)
  findChainRootsInWindow: jest.fn().mockResolvedValue(chain.roots ?? []),
  findChainFromRoot: jest
    .fn()
    .mockImplementation((rootRunId: number) =>
      Promise.resolve(chain.nodesByRoot?.[rootRunId] ?? []),
    ),
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

describe('RunRetroAutopilotTask — 체인 관측', () => {
  const healthyStats: AgentRunStatRow[] = [
    { agentType: 'PM', total: 11, failed: 0, failRate: 0, avgDurationMs: 1000 },
  ];

  it('실패 노드를 가진 체인을 회고에 표기한다', async () => {
    const service = makeService(healthyStats, healthyStats, {
      roots: [42],
      nodesByRoot: {
        42: [
          { id: 42, agentType: 'PM', status: 'SUCCEEDED', depth: 0 },
          { id: 43, agentType: 'CTO', status: 'FAILED', depth: 1 },
        ],
      },
    });
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('#42');
    expect(result.summaryText).toContain('CTO');
  });

  it('전부 성공한 체인은 하트비트를 깨지 않는다 (조용한 계기판)', async () => {
    const service = makeService(healthyStats, healthyStats, {
      roots: [42],
      nodesByRoot: {
        42: [
          { id: 42, agentType: 'PM', status: 'SUCCEEDED', depth: 0 },
          { id: 43, agentType: 'CTO', status: 'SUCCEEDED', depth: 1 },
        ],
      },
    });
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.summaryText).toContain('이상 없음');
  });

  it('체인 조회가 실패해도 통계 회고는 그대로 나간다', async () => {
    const service = makeService(healthyStats, healthyStats);
    service.findChainRootsInWindow = jest
      .fn()
      .mockRejectedValue(new Error('DB 연결 끊김'));
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
  });
});
