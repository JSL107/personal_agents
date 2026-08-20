import { AgentRunRepositoryPort } from '../../agent-run/domain/port/agent-run.repository.port';
import { BuildLedgerUsecase } from './build-ledger.usecase';

describe('BuildLedgerUsecase', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('원장 행을 한 번 조회해 ConsoleLedger로 조립한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-20T03:00:00.000Z'));
    const repository: jest.Mocked<
      Pick<AgentRunRepositoryPort, 'findAllRunsForLedger'>
    > = {
      findAllRunsForLedger: jest.fn().mockResolvedValue([
        {
          agentType: 'PM',
          triggerType: 'MORNING_BRIEFING_CRON',
          status: 'FAILED',
          startedAt: new Date('2026-08-20T00:00:00.000Z'),
        },
      ]),
    };
    const usecase = new BuildLedgerUsecase(
      repository as unknown as AgentRunRepositoryPort,
    );

    const result = await usecase.execute();

    expect(repository.findAllRunsForLedger).toHaveBeenCalledTimes(1);
    expect(result.company).toMatchObject({
      foundedDate: '2026-08-20',
      ageDays: 1,
      totalRuns: 1,
      failedRuns: 1,
    });
    expect(result.serverTime).toBe('2026-08-20T03:00:00.000Z');
    expect(result.agents[0]).toMatchObject({
      agentType: 'PM',
      totalRuns: 1,
      failedRuns: 1,
      autonomy: 'AUTONOMOUS',
    });
  });
});
