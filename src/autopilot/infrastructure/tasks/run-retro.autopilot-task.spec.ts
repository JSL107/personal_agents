import {
  AgentContractScoreRow,
  AgentRunStatRow,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { RunRetroAutopilotTask } from './run-retro.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-06' };

const makeService = (
  current: AgentRunStatRow[],
  previous: AgentRunStatRow[],
  chain: {
    roots?: number[];
    nodesByRoot?: Record<number, unknown[]>;
  } = {},
  contractScores: AgentContractScoreRow[] = [],
) => ({
  aggregateRunStats: jest
    .fn()
    .mockResolvedValueOnce(current) // 이번주 (sinceDays 7, untilDays 0)
    .mockResolvedValueOnce(previous), // 지난주 (sinceDays 14, untilDays 7)
  aggregateContractScores: jest.fn().mockResolvedValue(contractScores),
  findChainRootsInWindow: jest.fn().mockResolvedValue(chain.roots ?? []),
  findChainFromRoot: jest
    .fn()
    .mockImplementation((rootRunId: number) =>
      Promise.resolve(chain.nodesByRoot?.[rootRunId] ?? []),
    ),
});

describe('RunRetroAutopilotTask', () => {
  // 검수는 제 몫을 했는데 읽는 곳이 없어 167 건이 전건 0 점으로 쌓이는 동안 화면에 아무
  // 신호도 뜨지 않았다(2026-08-28 실측). 실행이 성공한 채로 남는 이상이라 실패율·지연 어느
  // 축에도 걸리지 않으므로, 이 경로가 유일한 관측 지점이다.
  it('계약 점수가 하한 아래인 워커를 카드에 싣는다', async () => {
    const stats: AgentRunStatRow[] = [
      {
        agentType: 'PAPER_TRADE',
        total: 171,
        failed: 0,
        failRate: 0,
        avgDurationMs: 900,
      },
    ];
    const service = makeService(stats, stats, {}, [
      { agentType: 'PAPER_TRADE', scoredCount: 171, avgScore: 0.023 },
      { agentType: 'PM', scoredCount: 7, avgScore: 1 },
    ]);

    const result = await new RunRetroAutopilotTask(service as never).run(
      context,
    );

    expect(service.aggregateContractScores).toHaveBeenCalledWith({
      sinceDays: 7,
      untilDays: 0,
    });
    expect(result.summaryText).toContain('PAPER_TRADE: 계약 점수 0.02');
    expect(result.summaryText).toContain('171건 평균, 하한 0.5');
    expect(result.summaryText).toContain('산출물이 계약과 어긋남');
    // 만점 워커는 실리지 않는다 — 조용한 계기판.
    expect(result.summaryText).not.toContain('PM: 계약 점수');
  });

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

  // 계약 점수는 부가 축이다 — 이 조회 하나의 사고가 실패율·지연 회고까지 막으면 원래 보려던
  // 신호가 함께 사라진다(체인 관측과 같은 정책).
  it('계약 점수 조회가 실패해도 통계 회고는 그대로 나간다', async () => {
    const service = makeService(healthyStats, healthyStats);
    service.aggregateContractScores = jest
      .fn()
      .mockRejectedValue(new Error('DB 연결 끊김'));
    const task = new RunRetroAutopilotTask(service as never);

    const result = await task.run(context);

    expect(result.skip).toBe(false);
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
