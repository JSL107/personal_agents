import {
  AgentRunRepositoryPort,
  QuotaStatRow,
} from '../domain/port/agent-run.repository.port';
import { GetQuotaStatsUsecase } from './get-quota-stats.usecase';

const buildRepo = (
  rows: QuotaStatRow[],
): jest.Mocked<AgentRunRepositoryPort> => ({
  begin: jest.fn(),
  finish: jest.fn(),
  recordEvidence: jest.fn(),
  findLatestSucceededRun: jest.fn(),
  findRecentSucceededRuns: jest.fn(),
  aggregateQuotaStats: jest.fn().mockResolvedValue(rows),
});

describe('GetQuotaStatsUsecase', () => {
  const fixedNow = new Date('2026-04-27T12:00:00.000Z');

  it('TODAY 는 24시간 전 since 로 repository 호출', async () => {
    const repo = buildRepo([]);
    const usecase = new GetQuotaStatsUsecase(repo);

    await usecase.execute({
      slackUserId: 'U1',
      range: 'TODAY',
      now: fixedNow,
    });

    expect(repo.aggregateQuotaStats).toHaveBeenCalledWith({
      slackUserId: 'U1',
      since: new Date('2026-04-26T12:00:00.000Z'),
    });
  });

  it('WEEK 는 7일 전 since 로 repository 호출', async () => {
    const repo = buildRepo([]);
    const usecase = new GetQuotaStatsUsecase(repo);

    await usecase.execute({
      slackUserId: 'U1',
      range: 'WEEK',
      now: fixedNow,
    });

    expect(repo.aggregateQuotaStats).toHaveBeenCalledWith({
      slackUserId: 'U1',
      since: new Date('2026-04-20T12:00:00.000Z'),
    });
  });

  it('rows 가 비어있으면 totals 도 0', async () => {
    const repo = buildRepo([]);
    const usecase = new GetQuotaStatsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      range: 'TODAY',
      now: fixedNow,
    });

    expect(result.rows).toEqual([]);
    expect(result.totals).toEqual({ count: 0, totalDurationMs: 0 });
    expect(result.range).toBe('TODAY');
    expect(result.sinceIso).toBe('2026-04-26T12:00:00.000Z');
  });

  it('rows 의 count 와 totalDurationMs 가 totals 로 합산', async () => {
    const repo = buildRepo([
      {
        cliProvider: 'codex-cli',
        count: 5,
        avgDurationMs: 12_000,
        totalDurationMs: 60_000,
      },
      {
        cliProvider: 'claude-cli',
        count: 3,
        avgDurationMs: 20_000,
        totalDurationMs: 60_000,
      },
    ]);
    const usecase = new GetQuotaStatsUsecase(repo);

    const result = await usecase.execute({
      slackUserId: 'U1',
      range: 'WEEK',
      now: fixedNow,
    });

    expect(result.totals).toEqual({ count: 8, totalDurationMs: 120_000 });
    expect(result.rows).toHaveLength(2);
  });
});
