import { ConfigService } from '@nestjs/config';

import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  DailyBar,
  DecimalValue,
} from '../../../market-data/domain/market-data.type';
import { MarketDataPort } from '../../../market-data/domain/port/market-data.port';
import { StockMonitorAutopilotTask } from './stock-monitor.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-22' };

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => value.toString(),
});

const bar = (
  tradeDate: string,
  adjClose: number,
  currency = 'KRW',
): DailyBar => ({
  tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
  close: decimal(adjClose),
  adjClose: decimal(adjClose),
  volume: 100n,
  currency,
});

const holdings = [
  {
    tickerId: 1,
    tickerName: 'SamsungElec',
    yahooSymbol: '005930.KS',
    quantity: decimal(10),
    avgPrice: decimal(100),
  },
  {
    tickerId: 2,
    tickerName: 'SKHynix',
    yahooSymbol: '000660.KS',
    quantity: decimal(5),
    avgPrice: decimal(100),
  },
];

const makeRepository = () => ({
  findCurrentHoldings: jest.fn().mockResolvedValue(holdings),
  findLatestStoredTradeDate: jest.fn(),
  upsertDailyPrice: jest.fn().mockResolvedValue(undefined),
  recordAlert: jest.fn().mockResolvedValue(undefined),
  findAlertsByTradeDate: jest.fn().mockResolvedValue([]),
  upsertFxRate: jest.fn().mockResolvedValue(undefined),
  findFxRate: jest.fn().mockResolvedValue(null),
});

// 원장에 실제로 남은 실행. AgentRunService 를 mock 하되 run() 을 그대로 통과시켜
// 본 로직은 손대지 않고, 무엇이 output 으로 적재됐는지만 관찰한다.
interface RecordedAgentRun {
  agentType: string;
  triggerType: string;
  modelUsed: string;
  inputSnapshot: unknown;
  output: unknown;
}
let recordedRuns: RecordedAgentRun[] = [];

const makeAgentRunService = (): AgentRunService =>
  ({
    execute: jest.fn(
      async (input: {
        agentType: string;
        triggerType: string;
        inputSnapshot: unknown;
        run: (context: unknown) => Promise<{
          result: unknown;
          modelUsed: string;
          output: unknown;
        }>;
      }) => {
        const executed = await input.run({});
        recordedRuns.push({
          agentType: input.agentType,
          triggerType: input.triggerType,
          modelUsed: executed.modelUsed,
          inputSnapshot: input.inputSnapshot,
          output: executed.output,
        });
        return {
          result: executed.result,
          modelUsed: executed.modelUsed,
          agentRunId: 1,
        };
      },
    ),
  }) as unknown as AgentRunService;

const makeTask = (
  marketData: Pick<MarketDataPort, 'fetchDailyBars'> &
    Partial<Pick<MarketDataPort, 'fetchUsdKrwRate'>>,
  repository: ReturnType<typeof makeRepository>,
  options: {
    id: 'stock-monitor' | 'stock-monitor-us';
    targetMarketCountry: 'KR' | 'US';
    now?: () => Date;
  } = { id: 'stock-monitor', targetMarketCountry: 'KR' },
  monitorEnabled = 'true',
): StockMonitorAutopilotTask =>
  new StockMonitorAutopilotTask(
    {
      ...options,
      now:
        options.now ??
        (options.targetMarketCountry === 'US'
          ? () => new Date('2026-07-23T20:30:00.000Z')
          : undefined),
    },
    {
      fetchUsdKrwRate: jest.fn().mockResolvedValue(null),
      ...marketData,
    } as MarketDataPort,
    repository as unknown as StockMonitorRepository,
    {
      get: jest.fn().mockReturnValue(monitorEnabled),
    } as unknown as ConfigService,
    makeAgentRunService(),
  );

describe('StockMonitorAutopilotTask', () => {
  beforeEach(() => {
    recordedRuns = [];
  });

  it('대상 marketCountry 보유 종목만 조회한다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );

    await makeTask(marketData, repository).run(context);

    expect(repository.findCurrentHoldings).toHaveBeenCalledWith({
      marketCountry: 'KR',
    });
  });

  it('휴장 판정 전 모든 종목을 수집해 실패도 함께 드러낸다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValueOnce([bar('2026-07-18', 100), bar('2026-07-21', 100)])
        .mockRejectedValueOnce(new Error('timeout')),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );

    const result = await makeTask(marketData, repository).run(context);

    expect(marketData.fetchDailyBars).toHaveBeenCalledTimes(2);
    expect(result.summaryText).toContain('휴장');
    expect(result.summaryText).toContain('수집 실패');
    expect(result.summaryText).toContain('000660.KS');
    expect(repository.upsertDailyPrice).not.toHaveBeenCalled();
  });

  it('한 종목이라도 새 거래일이면 전체 시장을 휴장으로 보지 않는다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValueOnce([bar('2026-07-18', 100), bar('2026-07-21', 100)])
        .mockResolvedValueOnce([
          bar('2026-07-21', 100),
          bar('2026-07-22', 100),
        ]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate
      .mockResolvedValueOnce(new Date('2026-07-21T00:00:00.000Z'))
      .mockResolvedValueOnce(new Date('2026-07-21T00:00:00.000Z'));

    const result = await makeTask(marketData, repository).run(context);

    expect(result.summaryText).not.toContain('휴장');
    expect(result.summaryText).toContain('수집 실패');
    expect(result.summaryText).toContain('005930.KS');
    expect(repository.upsertDailyPrice).toHaveBeenCalledTimes(1);
    expect(repository.upsertDailyPrice).toHaveBeenCalledWith(
      expect.objectContaining({ tickerId: 2 }),
    );
  });

  it('알림 기록이 실패하면 가격 checkpoint를 저장하지 않는다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 109)]),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([holdings[0]]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.recordAlert.mockRejectedValue(new Error('DB down'));

    const result = await makeTask(marketData, repository).run(context);

    expect(result.summaryText).toContain('수집 실패');
    expect(result.summaryText).toContain('005930.KS');
    expect(repository.upsertDailyPrice).not.toHaveBeenCalled();
  });

  it('한 종목 저장 실패가 앞 종목 anomaly 전달을 막지 않는다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 109)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.recordAlert
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('DB down'));

    const result = await makeTask(marketData, repository).run(context);

    expect(result.summaryText).toContain('SamsungElec');
    expect(result.summaryText).toContain('수집 실패');
    expect(result.summaryText).toContain('000660.KS');
    expect(repository.upsertDailyPrice).toHaveBeenCalledTimes(1);
  });

  it('Slack 전달 실패 후 같은 거래일 재시도에서는 저장된 anomaly를 다시 구성한다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 109)]),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([holdings[0]]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-22T00:00:00.000Z'),
    );
    repository.findAlertsByTradeDate.mockResolvedValue([
      {
        ruleId: 'daily-change',
        ruleVersion: 1,
        triggeredValue: 9,
        threshold: 8,
      },
    ]);

    const result = await makeTask(marketData, repository).run(context);

    expect(result.summaryText).not.toContain('휴장');
    expect(result.summaryText).toContain('SamsungElec');
    expect(result.summaryText).toContain('전일 대비 9.0% 급등');
    expect(repository.findAlertsByTradeDate).toHaveBeenCalledWith(
      holdings[0].tickerId,
      new Date('2026-07-22T00:00:00.000Z'),
    );
    expect(repository.recordAlert).not.toHaveBeenCalled();
    expect(repository.upsertDailyPrice).not.toHaveBeenCalled();
  });

  it('미국 태스크는 환율을 거래일로 저장하고 USD·원화를 표시한다', async () => {
    const unitedStatesHolding = {
      ...holdings[0],
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
      avgPrice: decimal(100),
    };
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([
          bar('2026-07-22', 100, 'USD'),
          bar('2026-07-23', 109, 'USD'),
        ]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('1476.3'),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([unitedStatesHolding]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-22T00:00:00.000Z'),
    );
    repository.findFxRate.mockResolvedValue('1476.3');
    const task = makeTask(marketData, repository, {
      id: 'stock-monitor-us',
      targetMarketCountry: 'US',
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-07-24',
    });

    expect(task.id).toBe('stock-monitor-us');
    expect(repository.findCurrentHoldings).toHaveBeenCalledWith({
      marketCountry: 'US',
    });
    expect(marketData.fetchUsdKrwRate).toHaveBeenCalledTimes(1);
    expect(repository.upsertFxRate).toHaveBeenCalledWith({
      pair: 'USDKRW',
      rateDate: new Date('2026-07-23T00:00:00.000Z'),
      rate: '1476.3',
    });
    expect(result.summaryText).toContain('USD 109');
    expect(result.summaryText).toContain('₩160,917 상당');
  });

  it('미국 환율 조회가 실패해도 USD 판정을 계속한다', async () => {
    const unitedStatesHolding = {
      ...holdings[0],
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([
          bar('2026-07-22', 100, 'USD'),
          bar('2026-07-23', 109, 'USD'),
        ]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue(null),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([unitedStatesHolding]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-22T00:00:00.000Z'),
    );
    const task = makeTask(marketData, repository, {
      id: 'stock-monitor-us',
      targetMarketCountry: 'US',
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-07-24',
    });

    expect(repository.upsertFxRate).not.toHaveBeenCalled();
    expect(repository.findFxRate).toHaveBeenCalledWith({
      pair: 'USDKRW',
      rateDate: new Date('2026-07-23T00:00:00.000Z'),
    });
    expect(result.summaryText).toContain('USD 109');
    expect(result.summaryText).not.toContain('상당');
    expect(repository.recordAlert).toHaveBeenCalled();
  });

  it('미국 태스크는 ET 거래일 기준으로 재시도 anomaly를 복구한다', async () => {
    const unitedStatesHolding = {
      ...holdings[0],
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([
          bar('2026-07-22', 100, 'USD'),
          bar('2026-07-23', 109, 'USD'),
        ]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue(null),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([unitedStatesHolding]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-23T00:00:00.000Z'),
    );
    repository.findAlertsByTradeDate.mockResolvedValue([
      {
        ruleId: 'daily-change',
        ruleVersion: 1,
        triggeredValue: 9,
        threshold: 8,
      },
    ]);
    const task = makeTask(marketData, repository, {
      id: 'stock-monitor-us',
      targetMarketCountry: 'US',
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-07-24',
    });

    expect(result.summaryText).not.toContain('휴장');
    expect(result.summaryText).toContain('AAPL');
    expect(repository.findAlertsByTradeDate).toHaveBeenCalled();
  });

  it('미국 cron이 오전 ET 로 override 돼도 실행 순간의 ET 거래일을 쓴다', async () => {
    const unitedStatesHolding = {
      ...holdings[0],
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([
          bar('2026-07-22', 100, 'USD'),
          bar('2026-07-23', 109, 'USD'),
        ]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue(null),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([unitedStatesHolding]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-23T00:00:00.000Z'),
    );
    repository.findAlertsByTradeDate.mockResolvedValue([
      {
        ruleId: 'daily-change',
        ruleVersion: 1,
        triggeredValue: 9,
        threshold: 8,
      },
    ]);
    const task = makeTask(marketData, repository, {
      id: 'stock-monitor-us',
      targetMarketCountry: 'US',
      now: () => new Date('2026-07-23T13:30:00.000Z'),
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-07-23',
    });

    expect(result.summaryText).not.toContain('휴장');
    expect(result.summaryText).toContain('AAPL');
  });

  it('비정상 환율은 저장·환산하지 않고 USD 판정을 계속한다', async () => {
    const unitedStatesHolding = {
      ...holdings[0],
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([
          bar('2026-07-22', 100, 'USD'),
          bar('2026-07-23', 109, 'USD'),
        ]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('not-a-rate'),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([unitedStatesHolding]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-22T00:00:00.000Z'),
    );
    const task = makeTask(marketData, repository, {
      id: 'stock-monitor-us',
      targetMarketCountry: 'US',
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-07-24',
    });

    expect(repository.upsertFxRate).not.toHaveBeenCalled();
    expect(result.summaryText).toContain('USD 109');
    expect(result.summaryText).not.toContain('상당');
    expect(repository.recordAlert).toHaveBeenCalled();
  });

  it('환율 DB 저장이 실패해도 조회된 환율로 표시하고 판정을 계속한다', async () => {
    const unitedStatesHolding = {
      ...holdings[0],
      tickerName: 'Apple',
      yahooSymbol: 'AAPL',
    };
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([
          bar('2026-07-22', 100, 'USD'),
          bar('2026-07-23', 109, 'USD'),
        ]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('1476.3'),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([unitedStatesHolding]);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-22T00:00:00.000Z'),
    );
    repository.upsertFxRate.mockRejectedValue(new Error('DB down'));
    const task = makeTask(marketData, repository, {
      id: 'stock-monitor-us',
      targetMarketCountry: 'US',
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-07-24',
    });

    expect(result.summaryText).toContain('₩160,917 상당');
    expect(repository.recordAlert).toHaveBeenCalled();
  });

  // ── 원장 편입 (INVEST) ──────────────────────────────────────────────
  // 이 셋이 이 태스크의 관측 계약이다. 감시가 켜져 있는 한 실행은 화면에 아무것도
  // 보내지 않는 날에도 원장에 남아야 하고, 꺼져 있으면 남지 않아야 한다.

  it('보유 종목이 0건이어도 원장에는 남긴다 — 화면엔 안 보내도 실행 사실은 관측돼야 한다', async () => {
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([]);

    const result = await makeTask(
      { fetchDailyBars: jest.fn() },
      repository,
    ).run(context);

    // 화면: 빈 알림을 보내지 않는다(기존 동작 유지)
    expect(result.skip).toBe(true);
    // 원장: 그래도 남는다 — 이 한 줄이 없어서 "켜둔 채 대상 0건" 상태가 방치됐다
    expect(recordedRuns).toHaveLength(1);
    expect(recordedRuns[0].agentType).toBe('INVEST');
    expect(recordedRuns[0].triggerType).toBe('AUTOPILOT_INVEST_CRON');
    expect(recordedRuns[0].output).toMatchObject({
      marketCountry: 'KR',
      holdingCount: 0,
      checkedCount: 0,
      anomalyCount: 0,
    });
  });

  it('감시가 꺼져 있으면 원장에도 남기지 않는다', async () => {
    const repository = makeRepository();

    const result = await makeTask(
      { fetchDailyBars: jest.fn() },
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'false',
    ).run(context);

    expect(result.skip).toBe(true);
    expect(recordedRuns).toHaveLength(0);
    // 게이트가 조회보다 앞이어야 한다 — 꺼둔 기능이 DB 를 건드리면 안 된다
    expect(repository.findCurrentHoldings).not.toHaveBeenCalled();
  });

  it('정상 실행은 LLM 없이 deterministic 으로 기록되고 시장 구분이 남는다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );

    await makeTask(marketData, repository).run(context);

    expect(recordedRuns).toHaveLength(1);
    expect(recordedRuns[0].modelUsed).toBe('deterministic');
    expect(recordedRuns[0].inputSnapshot).toMatchObject({
      taskId: 'stock-monitor',
      marketCountry: 'KR',
    });
    expect(recordedRuns[0].output).toMatchObject({
      holdingCount: 2,
      checkedCount: 2,
    });
  });
});
