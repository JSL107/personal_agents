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
});
