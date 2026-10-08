import { RUN_VERDICT_SOURCE } from '../domain/run-verdict';
import { AgentRunVerdictPrismaRepository } from './agent-run-verdict.prisma.repository';

describe('AgentRunVerdictPrismaRepository', () => {
  it('다시 누르면 같은 (실행, 축, 사람) 행을 덮어쓰고 처음 판정한 시각은 건드리지 않는다', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const repository = new AgentRunVerdictPrismaRepository({
      agentRunVerdict: { upsert },
    } as never);

    await repository.record({
      agentRunId: 6300,
      facet: 'retro_problem',
      verdict: 'REAL',
      slackUserId: 'U1',
      source: RUN_VERDICT_SOURCE.BUTTON,
    });
    await repository.record({
      agentRunId: 6300,
      facet: 'retro_problem',
      verdict: 'FABRICATED',
      slackUserId: 'U1',
      source: RUN_VERDICT_SOURCE.BUTTON,
    });

    expect(upsert).toHaveBeenCalledTimes(2);
    const second = upsert.mock.calls[1][0];
    expect(second.where).toEqual({
      agentRunId_facet_slackUserId: {
        agentRunId: 6300,
        facet: 'retro_problem',
        slackUserId: 'U1',
      },
    });
    expect(second.update).toEqual({ verdict: 'FABRICATED', source: 'button' });
    expect(second.update).not.toHaveProperty('createdAt');
  });

  // 관계가 없어 두 번 묻는다 — 창 밖 실행의 판정은 빠지고, KNOWN 은 건수에만 든다.
  it('agentType 별로 판정을 세고, 창 밖 실행과 좋음/나쁨이 아닌 값은 분포에서 뺀다', async () => {
    const verdictFindMany = jest.fn().mockResolvedValue([
      { agentRunId: 1, verdict: 'REAL' },
      { agentRunId: 1, verdict: 'BAD' },
      { agentRunId: 2, verdict: 'KNOWN' },
      { agentRunId: 2, verdict: 'GOOD' },
      { agentRunId: 3, verdict: 'FABRICATED' },
      // 창 밖 실행 — 두 번째 조회가 돌려주지 않는다.
      { agentRunId: 99, verdict: 'GOOD' },
    ]);
    const runFindMany = jest.fn().mockResolvedValue([
      { id: 1, agentType: 'WORK_REVIEWER' },
      { id: 2, agentType: 'PO_SHADOW' },
      { id: 3, agentType: 'WORK_REVIEWER' },
    ]);
    const repository = new AgentRunVerdictPrismaRepository({
      agentRunVerdict: { findMany: verdictFindMany },
      agentRun: { findMany: runFindMany },
    } as never);

    const rows = await repository.countByAgentType({ sinceDays: 7 });

    expect(rows).toEqual([
      { agentType: 'WORK_REVIEWER', total: 3, good: 1, bad: 2 },
      { agentType: 'PO_SHADOW', total: 2, good: 1, bad: 0 },
    ]);
    expect(runFindMany.mock.calls[0][0].where.id).toEqual({
      in: [1, 2, 3, 99],
    });
  });

  it('판정이 하나도 없으면 실행 조회를 하지 않는다', async () => {
    const runFindMany = jest.fn();
    const repository = new AgentRunVerdictPrismaRepository({
      agentRunVerdict: { findMany: jest.fn().mockResolvedValue([]) },
      agentRun: { findMany: runFindMany },
    } as never);

    await expect(
      repository.countByAgentType({ sinceDays: 7 }),
    ).resolves.toEqual([]);
    expect(runFindMany).not.toHaveBeenCalled();
  });
});
