import {
  AgentRunRepositoryPort,
  LatestRunRow,
} from '../../agent-run/domain/port/agent-run.repository.port';
import {
  BuildActivityUsecase,
  RECENT_RUN_LIMIT,
  RECENT_RUN_PAGE_SIZE,
} from './build-activity.usecase';

const tick = (id: number, agentType = 'PAPER_TRADE'): LatestRunRow => ({
  id,
  agentType,
  triggerType: 'AUTOPILOT_PAPER_INTRADAY_STOP_CRON',
  status: 'SUCCEEDED',
  startedAt: new Date(Date.UTC(2026, 9, 6) + id * 60_000),
  endedAt: null,
  inputSnapshot: null,
});

const buildUsecase = (
  pages: LatestRunRow[][],
): {
  usecase: BuildActivityUsecase;
  findLatestRuns: jest.Mock;
} => {
  const findLatestRuns = jest.fn();
  for (const page of pages) {
    findLatestRuns.mockResolvedValueOnce(page);
  }
  findLatestRuns.mockResolvedValue([]);
  const repository = {
    findRunsStartedSince: jest.fn().mockResolvedValue([]),
    findLatestRuns,
  } as unknown as AgentRunRepositoryPort;
  return { usecase: new BuildActivityUsecase(repository), findLatestRuns };
};

describe('BuildActivityUsecase 최근 실행 이어 읽기', () => {
  it('한 페이지를 넘겨 연달아 돈 실행도 끝까지 세고, 커서로 다음 페이지를 읽는다', async () => {
    // 손절 점검 70회 연속 → 그 뒤(더 오래된 쪽)에 다른 실행 8건.
    const ids = Array.from({ length: 70 }, (_, index) => 1000 - index);
    const ticks = ids.map((id) => tick(id));
    const others = Array.from({ length: 8 }, (_, index) =>
      tick(900 - index, `AGENT_${index}`),
    );
    const all = [...ticks, ...others];
    const { usecase, findLatestRuns } = buildUsecase([
      all.slice(0, RECENT_RUN_PAGE_SIZE),
      all.slice(RECENT_RUN_PAGE_SIZE, RECENT_RUN_PAGE_SIZE * 2),
    ]);

    const result = await usecase.execute();

    expect(result.recentRuns[0]).toMatchObject({ id: '1000', count: 70 });
    expect(result.recentRuns).toHaveLength(RECENT_RUN_LIMIT);
    expect(findLatestRuns).toHaveBeenNthCalledWith(2, {
      limit: RECENT_RUN_PAGE_SIZE,
      before: {
        startedAt: all[RECENT_RUN_PAGE_SIZE - 1].startedAt,
        id: all[RECENT_RUN_PAGE_SIZE - 1].id,
      },
    });
  });

  it('원장이 한 페이지보다 짧으면 한 번만 읽는다', async () => {
    const { usecase, findLatestRuns } = buildUsecase([[tick(2), tick(1)]]);

    const result = await usecase.execute();

    expect(findLatestRuns).toHaveBeenCalledTimes(1);
    expect(result.recentRuns).toEqual([
      expect.objectContaining({ id: '2', count: 2 }),
    ]);
  });
});
