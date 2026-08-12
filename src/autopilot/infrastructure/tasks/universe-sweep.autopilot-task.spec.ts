import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CollectBenchmarkClosesUsecase } from '../../../screener/application/collect-benchmark-closes.usecase';
import { CollectUniversePricesUsecase } from '../../../screener/application/collect-universe-prices.usecase';
import { SyncUniverseUsecase } from '../../../screener/application/sync-universe.usecase';
import { UniverseSweepAutopilotTask } from './universe-sweep.autopilot-task';

const createFixture = (enabled = 'true') => {
  const calls: string[] = [];
  const syncUniverse = {
    execute: jest.fn(async () => {
      calls.push('sync');
      return { fetched: 2595, upserted: 2595, delisted: 2 };
    }),
  };
  const collectPrices = {
    execute: jest.fn(async () => {
      calls.push('collect');
      return {
        targetCount: 2595,
        succeeded: 2594,
        failed: 1,
        written: 12970,
        blockedIntraday: 0,
        readjusted: 1,
        retried: 5,
        failures: ['000001: 시세 조회 실패'],
      };
    }),
  };
  const collectBenchmark = {
    execute: jest.fn(async () => {
      calls.push('benchmark');
      return {
        symbol: 'KOSPI',
        fetched: 5,
        written: 4,
        blockedIntraday: 1,
        latestTradeDate: '2026-08-11',
      };
    }),
  };
  const config = { get: jest.fn().mockReturnValue(enabled) };
  const agentRun = {
    execute: jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 91 });
      return { ...execution, agentRunId: 91 };
    }),
  };

  return {
    task: new UniverseSweepAutopilotTask(
      syncUniverse as unknown as SyncUniverseUsecase,
      collectPrices as unknown as CollectUniversePricesUsecase,
      collectBenchmark as unknown as CollectBenchmarkClosesUsecase,
      config as unknown as ConfigService,
      agentRun as unknown as AgentRunService,
    ),
    syncUniverse,
    collectPrices,
    collectBenchmark,
    agentRun,
    calls,
  };
};

describe('UniverseSweepAutopilotTask', () => {
  it('SCREENER_ENABLED가 꺼져 있으면 usecase와 원장을 호출하지 않는다', async () => {
    const fixture = createFixture('false');

    await expect(
      fixture.task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-17' }),
    ).resolves.toEqual({ skip: true });
    expect(fixture.syncUniverse.execute).not.toHaveBeenCalled();
    expect(fixture.collectPrices.execute).not.toHaveBeenCalled();
    expect(fixture.collectBenchmark.execute).not.toHaveBeenCalled();
    expect(fixture.agentRun.execute).not.toHaveBeenCalled();
  });

  it('KST 월요일에는 유니버스를 동기화한 뒤 증분 시세를 수집한다', async () => {
    const fixture = createFixture();

    const result = await fixture.task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(fixture.calls).toEqual(['sync', 'collect', 'benchmark']);
    expect(result).toEqual({
      skip: false,
      summaryText:
        '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 벤치마크 KOSPI 4봉',
      detailText: '시세 수집 실패 상세\n- 000001: 시세 조회 실패',
    });
    expect(fixture.agentRun.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.INVEST,
        triggerType: TriggerType.AUTOPILOT_INVEST_CRON,
        inputSnapshot: {
          taskId: 'universe-sweep',
          firedAtKst: '2026-08-17',
        },
      }),
    );
    const run = fixture.agentRun.execute.mock.calls[0][0].run;
    await expect(run({ agentRunId: 91 })).resolves.toEqual({
      result: {
        skip: false,
        summaryText:
          '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 벤치마크 KOSPI 4봉',
        detailText: '시세 수집 실패 상세\n- 000001: 시세 조회 실패',
      },
      modelUsed: 'deterministic',
      output: {
        sync: { fetched: 2595, upserted: 2595, delisted: 2 },
        collection: {
          targetCount: 2595,
          succeeded: 2594,
          failed: 1,
          written: 12970,
          blockedIntraday: 0,
          readjusted: 1,
          retried: 5,
          failures: ['000001: 시세 조회 실패'],
        },
        benchmark: {
          symbol: 'KOSPI',
          fetched: 5,
          written: 4,
          blockedIntraday: 1,
          latestTradeDate: '2026-08-11',
        },
      },
    });
  });

  it('KST 월요일이 아니어도 유니버스를 동기화한 뒤 시세를 수집한다', async () => {
    const fixture = createFixture();

    await expect(
      fixture.task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-18' }),
    ).resolves.toEqual({
      skip: false,
      summaryText:
        '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 벤치마크 KOSPI 4봉',
      detailText: '시세 수집 실패 상세\n- 000001: 시세 조회 실패',
    });

    expect(fixture.calls).toEqual(['sync', 'collect', 'benchmark']);
    expect(fixture.syncUniverse.execute).toHaveBeenCalledWith();
    expect(fixture.collectPrices.execute).toHaveBeenCalledWith();
    expect(fixture.collectBenchmark.execute).toHaveBeenCalledWith();
  });

  it('벤치마크 수집 실패를 요약에 남기고 유니버스 스윕은 성공 처리한다', async () => {
    const fixture = createFixture();
    fixture.collectBenchmark.execute.mockImplementationOnce(async () => {
      fixture.calls.push('benchmark');
      throw new Error('시장 지표 rate limit');
    });

    await expect(
      fixture.task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-18' }),
    ).resolves.toEqual({
      skip: false,
      summaryText:
        '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 벤치마크 KOSPI 실패(시장 지표 rate limit)',
      detailText: '시세 수집 실패 상세\n- 000001: 시세 조회 실패',
    });
    expect(fixture.calls).toEqual(['sync', 'collect', 'benchmark']);

    const execution = await fixture.agentRun.execute.mock.results[0].value;
    expect(execution).toEqual(
      expect.objectContaining({
        modelUsed: 'deterministic',
        output: {
          sync: { fetched: 2595, upserted: 2595, delisted: 2 },
          collection: expect.objectContaining({ written: 12970 }),
          benchmark: {
            symbol: 'KOSPI',
            error: '시장 지표 rate limit',
          },
        },
      }),
    );
  });
});
