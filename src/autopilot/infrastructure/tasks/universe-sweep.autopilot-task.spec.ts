import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CollectBenchmarkClosesUsecase } from '../../../screener/application/collect-benchmark-closes.usecase';
import { CollectInvestorFlowUsecase } from '../../../screener/application/collect-investor-flow.usecase';
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
        dormant: ['094800'],
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
  const collectInvestorFlow = {
    execute: jest.fn(async () => {
      calls.push('flow');
      return {
        targetCount: 2595,
        succeeded: 2594,
        failed: 1,
        written: 100,
        failures: ['000002: 응답 실패'],
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
      collectInvestorFlow as unknown as CollectInvestorFlowUsecase,
      config as unknown as ConfigService,
      agentRun as unknown as AgentRunService,
    ),
    syncUniverse,
    collectPrices,
    collectBenchmark,
    collectInvestorFlow,
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
    expect(fixture.collectInvestorFlow.execute).not.toHaveBeenCalled();
    expect(fixture.agentRun.execute).not.toHaveBeenCalled();
  });

  it('KST 월요일에는 유니버스를 동기화한 뒤 증분 시세를 수집한다', async () => {
    const fixture = createFixture();

    const result = await fixture.task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(fixture.calls).toEqual(['sync', 'collect', 'benchmark', 'flow']);
    expect(result).toEqual({
      skip: false,
      summaryText:
        '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 시세 공급 중단 1종목(094800), 벤치마크 KOSPI 4봉 · 수급 2,594/2,595종목, 저장 100건, 실패 1종목',
      detailText:
        '시세 수집 실패 상세\n- 000001: 시세 조회 실패\n\n수급 수집 실패 상세\n- 000002: 응답 실패',
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
          '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 시세 공급 중단 1종목(094800), 벤치마크 KOSPI 4봉 · 수급 2,594/2,595종목, 저장 100건, 실패 1종목',
        detailText:
          '시세 수집 실패 상세\n- 000001: 시세 조회 실패\n\n수급 수집 실패 상세\n- 000002: 응답 실패',
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
          dormant: ['094800'],
        },
        benchmark: {
          symbol: 'KOSPI',
          fetched: 5,
          written: 4,
          blockedIntraday: 1,
          latestTradeDate: '2026-08-11',
        },
        investorFlow: {
          targetCount: 2595,
          succeeded: 2594,
          failed: 1,
          written: 100,
          failures: ['000002: 응답 실패'],
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
        '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 시세 공급 중단 1종목(094800), 벤치마크 KOSPI 4봉 · 수급 2,594/2,595종목, 저장 100건, 실패 1종목',
      detailText:
        '시세 수집 실패 상세\n- 000001: 시세 조회 실패\n\n수급 수집 실패 상세\n- 000002: 응답 실패',
    });

    expect(fixture.calls).toEqual(['sync', 'collect', 'benchmark', 'flow']);
    expect(fixture.syncUniverse.execute).toHaveBeenCalledWith();
    expect(fixture.collectPrices.execute).toHaveBeenCalledWith();
    expect(fixture.collectBenchmark.execute).toHaveBeenCalledWith();
    expect(fixture.collectInvestorFlow.execute).toHaveBeenCalledWith();
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
        '유니버스 스윕 완료 — 동기화 2,595건(상폐 2건), 수집 성공 2,594/2,595종목, 저장 12,970봉, 재조정 1종목, 429 재시도 성공 5종목, 장중 차단 0봉, 실패 1종목, 시세 공급 중단 1종목(094800), 벤치마크 KOSPI 실패(시장 지표 rate limit) · 수급 2,594/2,595종목, 저장 100건, 실패 1종목',
      detailText:
        '시세 수집 실패 상세\n- 000001: 시세 조회 실패\n\n수급 수집 실패 상세\n- 000002: 응답 실패',
    });
    expect(fixture.calls).toEqual(['sync', 'collect', 'benchmark', 'flow']);

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
          investorFlow: expect.objectContaining({ failed: 1 }),
        },
      }),
    );
  });

  it('수급 수집 단계 예외를 상세에 남기되 스윕을 실패시키지 않는다', async () => {
    const fixture = createFixture();
    fixture.collectInvestorFlow.execute.mockRejectedValueOnce(
      new Error('네이버 응답 실패'),
    );

    await expect(
      fixture.task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-18' }),
    ).resolves.toEqual(
      expect.objectContaining({
        skip: false,
        summaryText: expect.stringContaining(
          '수급 수집 실패(네이버 응답 실패)',
        ),
        detailText: expect.stringContaining('수급 수집 단계 실패'),
      }),
    );
  });

  it('시세 공급 중단이 3종목을 넘으면 코드 3개만 적고 나머지는 수로 적는다', async () => {
    const fixture = createFixture();
    fixture.collectPrices.execute.mockImplementationOnce(async () => ({
      targetCount: 2595,
      succeeded: 2590,
      failed: 1,
      written: 12970,
      blockedIntraday: 0,
      readjusted: 1,
      retried: 5,
      failures: ['000001: 시세 조회 실패'],
      dormant: ['094800', '123456', '222222', '333333', '444444'],
    }));

    const result = await fixture.task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-18',
    });

    // 코드를 전부 적으면 요약 한 줄이 종목 목록으로 덮인다.
    expect(result.summaryText).toContain(
      '시세 공급 중단 5종목(094800, 123456, 222222 외 2종목)',
    );
  });
});
