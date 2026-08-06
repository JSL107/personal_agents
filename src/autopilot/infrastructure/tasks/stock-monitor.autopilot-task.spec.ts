import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { SyncHoldingsUsecase } from '../../../agent/stock/application/sync-holdings.usecase';
import { HoldingChange } from '../../../agent/stock/domain/holding-change';
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
    symbol: '005930',
    quantity: decimal(10),
    avgPrice: decimal(100),
  },
  {
    tickerId: 2,
    tickerName: 'SKHynix',
    symbol: '000660',
    quantity: decimal(5),
    avgPrice: decimal(100),
  },
];

const makeRepository = () => ({
  findCurrentHoldings: jest.fn().mockResolvedValue(holdings),
  findPortfolioPositions: jest.fn().mockResolvedValue([]),
  findLatestStoredTradeDate: jest.fn(),
  upsertDailyPrice: jest.fn().mockResolvedValue(undefined),
  recordAlert: jest.fn().mockResolvedValue(undefined),
  findAlertsByTradeDate: jest.fn().mockResolvedValue([]),
  upsertFxRate: jest.fn().mockResolvedValue(undefined),
  findFxRate: jest.fn().mockResolvedValue(null),
});

const portfolioPositions = [
  {
    region: 'US',
    direction: 'LONG',
    currency: 'USD',
    quantity: new Prisma.Decimal(1),
    close: new Prisma.Decimal(1),
  },
  {
    region: 'KR',
    direction: 'SHORT',
    currency: 'KRW',
    quantity: new Prisma.Decimal(1),
    close: new Prisma.Decimal(2),
  },
];

const makeSyncHoldings = () => ({
  execute: jest.fn().mockResolvedValue({ synced: 2, zeroed: 0, changes: [] }),
});

const holdingChange = (
  overrides: Partial<HoldingChange> = {},
): HoldingChange => ({
  tickerId: 1,
  tickerName: 'SamsungElec',
  symbol: '005930',
  kind: 'INCREASED',
  previousQuantity: '10',
  quantity: '20',
  previousAvgPrice: '100',
  avgPrice: '95',
  currency: 'KRW',
  ...overrides,
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
  syncHoldings = makeSyncHoldings(),
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
    syncHoldings as unknown as SyncHoldingsUsecase,
  );

describe('StockMonitorAutopilotTask', () => {
  beforeEach(() => {
    recordedRuns = [];
  });

  it('잔고 동기화를 보유 종목 판정보다 먼저 1회 수행한다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    const syncHoldings = makeSyncHoldings();

    await makeTask(
      marketData,
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(syncHoldings.execute).toHaveBeenCalledTimes(1);
    expect(syncHoldings.execute.mock.invocationCallOrder[0]).toBeLessThan(
      repository.findCurrentHoldings.mock.invocationCallOrder[0],
    );
  });

  it('잔고 동기화 성공 건수를 원장 audit에 남긴다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockResolvedValue({
      synced: 6,
      zeroed: 2,
      changes: [],
    });

    await makeTask(
      marketData,
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(recordedRuns[0].output).toMatchObject({
      syncedHoldings: 6,
      zeroedHoldings: 2,
      holdingChangeCount: 0,
      syncError: null,
    });
  });

  it('잔고 동기화 실패를 경고하되 기존 잔고 감시를 계속한다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockRejectedValue(new Error('Toss timeout'));

    const result = await makeTask(
      marketData,
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(repository.findCurrentHoldings).toHaveBeenCalled();
    expect(result.summaryText).toMatch(/^⚠️ 잔고 동기화 실패/);
    expect(recordedRuns[0].output).toMatchObject({
      syncedHoldings: null,
      zeroedHoldings: null,
      // 변화 0건(감지가 돌았고 매매가 없었다)과 구분되어야 한다.
      holdingChangeCount: null,
      syncError: 'Toss timeout',
    });
  });

  it('감지한 매매를 요약에 덧붙이고 원장에 건수를 남긴다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockResolvedValue({
      synced: 2,
      zeroed: 0,
      changes: [
        holdingChange(),
        holdingChange({
          tickerId: 2,
          symbol: 'PFE',
          tickerName: '화이자',
          currency: 'USD',
          kind: 'BOUGHT',
          previousQuantity: null,
          previousAvgPrice: null,
          quantity: '62.0845',
          avgPrice: '26.8245',
        }),
      ],
    });

    const result = await makeTask(
      marketData,
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(result.summaryText).toContain('💼 *잔고 변화 2건*');
    expect(result.summaryText).toContain(
      '• *SamsungElec* — 추가 매수 10주 → 20주, 평단 100원 → 95원',
    );
    expect(result.summaryText).toContain(
      '• 🇺🇸 *PFE* — 신규 매수 62.0845주 (평단 USD 26.8245)',
    );
    // 감시 판정 요약을 밀어내지 않고 그 뒤에 붙는다.
    expect(result.summaryText).toMatch(/주식 모니터링[\s\S]*잔고 변화/);
    expect(recordedRuns[0].output).toMatchObject({ holdingChangeCount: 2 });
  });

  it('매매가 없으면 요약에 잔고 변화 줄을 넣지 않는다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );

    const result = await makeTask(marketData, repository).run(context);

    expect(result.summaryText).not.toContain('잔고 변화');
  });

  // 감시가 통째로 실패해도 매매는 이미 감지·적재됐다. 여기서 알림을 버리면 스냅샷이 이미
  // 갱신돼 다음 실행은 0건으로 보고, 사용자는 그 매매를 영구히 듣지 못한다.
  it('모든 종목 점검이 실패해도 감지한 매매는 알린다', async () => {
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(null);
    const marketData = {
      fetchDailyBars: jest.fn().mockRejectedValue(new Error('Yahoo 503')),
    };
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockResolvedValue({
      synced: 2,
      zeroed: 0,
      changes: [holdingChange()],
    });

    const result = await makeTask(
      marketData,
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('주식 모니터링 실패');
    expect(result.summaryText).toContain('추가 매수 10주 → 20주');
    // 예외는 AgentRunService.execute 안에서 났으므로 원장에는 성공으로 남지 않는다.
    // FAILED 기록 자체는 AgentRunService 의 책임이라 여기서 단언하지 않는다(mock 이 그 경로를
    // 모사하지 않으므로, 단언하면 mock 동작을 검증하는 셈이 된다).
    expect(recordedRuns).toHaveLength(0);
  });

  it('점검이 모두 실패하고 매매도 없으면 기존대로 실패를 올린다', async () => {
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(null);
    const marketData = {
      fetchDailyBars: jest.fn().mockRejectedValue(new Error('Yahoo 503')),
    };

    await expect(makeTask(marketData, repository).run(context)).rejects.toThrow(
      /한 건도 점검하지 못했습니다/,
    );
  });

  // 전량 매도 직후가 이 경로다. 보유가 0건이라 판정은 건너뛰지만 "다 팔았다"는 알려야 한다.
  it('보유 종목이 0건이어도 감지한 매매는 발송한다', async () => {
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([]);
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockResolvedValue({
      synced: 0,
      zeroed: 1,
      changes: [
        holdingChange({
          kind: 'SOLD_ALL',
          previousQuantity: '10',
          quantity: '0',
          previousAvgPrice: '100',
          avgPrice: '100',
        }),
      ],
    });

    const result = await makeTask(
      { fetchDailyBars: jest.fn() },
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('• *SamsungElec* — 전량 매도 (10주)');
    expect(recordedRuns[0].output).toMatchObject({
      holdingCount: 0,
      holdingChangeCount: 1,
    });
  });

  it('잔고 동기화 실패 후 보유 종목이 0건이어도 경고를 발송한다', async () => {
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue([]);
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockRejectedValue(new Error('Toss timeout'));

    const result = await makeTask(
      { fetchDailyBars: jest.fn() },
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('⚠️ 잔고 동기화 실패');
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
    expect(result.summaryText).toContain('000660');
    expect(repository.upsertDailyPrice).not.toHaveBeenCalled();
    expect(recordedRuns[0].output).toMatchObject({
      syncedHoldings: 2,
      zeroedHoldings: 0,
      syncError: null,
    });
  });

  it('국내 감시도 환율을 한 번 조회해 정상 요약 끝에 포트폴리오 노출을 덧붙인다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockResolvedValue(portfolioPositions);

    const result = await makeTask(marketData, repository).run(context);

    expect(marketData.fetchUsdKrwRate).toHaveBeenCalledTimes(1);
    expect(result.summaryText).toContain('📉 *주식 모니터링*');
    expect(result.summaryText).toContain(
      '🌎 미국 주식 50% · 코스피 숏 50% (달러 환노출 50%)',
    );
  });

  it('종목 수집이 일부 실패하면 실패 요약은 남기고 포트폴리오 노출을 생략한다', async () => {
    const testHoldings = [
      { ...holdings[0], tickerName: 'TEST-1', symbol: 'AAA' },
      { ...holdings[1], tickerName: 'TEST-2', symbol: 'BBB' },
    ];
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValueOnce([bar('2026-07-21', 100), bar('2026-07-22', 100)])
        .mockRejectedValueOnce(new Error('timeout')),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue(testHoldings);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockResolvedValue(portfolioPositions);
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    try {
      const result = await makeTask(marketData, repository).run(context);

      expect(result.summaryText).toContain('수집 실패');
      expect(result.summaryText).toContain('BBB');
      expect(result.summaryText).not.toContain('🌎');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('포트폴리오 노출 생략'),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('잔고 동기화가 실패하면 경고는 남기고 포트폴리오 노출을 생략한다', async () => {
    const testHoldings = [
      { ...holdings[0], tickerName: 'TEST-1', symbol: 'AAA' },
      { ...holdings[1], tickerName: 'TEST-2', symbol: 'BBB' },
    ];
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findCurrentHoldings.mockResolvedValue(testHoldings);
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockResolvedValue(portfolioPositions);
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockRejectedValue(new Error('sync timeout'));
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    try {
      const result = await makeTask(
        marketData,
        repository,
        { id: 'stock-monitor', targetMarketCountry: 'KR' },
        'true',
        syncHoldings,
      ).run(context);

      expect(result.summaryText).toContain('⚠️ 잔고 동기화 실패');
      expect(result.summaryText).not.toContain('🌎');
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('포트폴리오 노출 생략'),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('포트폴리오 노출을 잔고 변화 블록보다 먼저 표시한다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockResolvedValue(portfolioPositions);
    const syncHoldings = makeSyncHoldings();
    syncHoldings.execute.mockResolvedValue({
      synced: 1,
      zeroed: 0,
      changes: [
        holdingChange({
          tickerName: 'TEST-1',
          symbol: 'AAA',
          kind: 'BOUGHT',
          previousQuantity: null,
          previousAvgPrice: null,
          quantity: '1',
          avgPrice: '1',
        }),
      ],
    });

    const result = await makeTask(
      marketData,
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'true',
      syncHoldings,
    ).run(context);

    const exposureIndex = result.summaryText!.indexOf('🌎 ');
    const holdingChangesIndex = result.summaryText!.indexOf('💼 *잔고 변화');
    expect(exposureIndex).toBeGreaterThanOrEqual(0);
    expect(holdingChangesIndex).toBeGreaterThanOrEqual(0);
    expect(exposureIndex).toBeLessThan(holdingChangesIndex);
  });

  it('휴장 요약에도 포트폴리오 노출을 덧붙인다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-18', 100), bar('2026-07-21', 100)]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockResolvedValue(portfolioPositions);

    const result = await makeTask(marketData, repository).run(context);

    expect(result.summaryText).toContain('휴장');
    expect(result.summaryText).toContain(
      '🌎 미국 주식 50% · 코스피 숏 50% (달러 환노출 50%)',
    );
  });

  it('포트폴리오 노출 계산 실패는 기존 요약을 보존하고 경고한다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockRejectedValue(new Error('DB down'));
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    try {
      const result = await makeTask(marketData, repository).run(context);

      expect(result.summaryText).toContain('📉 *주식 모니터링*');
      expect(result.summaryText).not.toContain('🌎');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('포트폴리오 노출 계산 실패'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('포트폴리오 노출은 화면 전용이며 원장 audit에 남기지 않는다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValue([bar('2026-07-21', 100), bar('2026-07-22', 100)]),
      fetchUsdKrwRate: jest.fn().mockResolvedValue('2'),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );
    repository.findPortfolioPositions.mockResolvedValue(portfolioPositions);

    await makeTask(marketData, repository).run(context);

    expect(recordedRuns[0].output).not.toHaveProperty('buckets');
    expect(recordedRuns[0].output).not.toHaveProperty('fxUsdRatio');
    expect(recordedRuns[0].output).not.toHaveProperty('portfolioExposure');
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
    expect(result.summaryText).toContain('005930');
    expect(repository.upsertDailyPrice).toHaveBeenCalledTimes(1);
    expect(repository.upsertDailyPrice).toHaveBeenCalledWith(
      expect.objectContaining({ tickerId: 2 }),
    );
  });

  it('알림 기록이 실패하면 가격 checkpoint를 저장하지 않고, 전부 실패라 예외로 전파한다', async () => {
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

    // 보유 1종목이 곧 전부다. 여기서 정상 반환하면 원장에 SUCCEEDED 로 남아
    // "감시가 돌았다"로 집계된다 — 실패를 보이게 하려던 목적과 반대가 된다.
    await expect(makeTask(marketData, repository).run(context)).rejects.toThrow(
      '한 건도 점검하지 못했습니다',
    );
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
    expect(result.summaryText).toContain('000660');
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
      symbol: 'AAPL',
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
      symbol: 'AAPL',
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
      symbol: 'AAPL',
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
      symbol: 'AAPL',
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
      symbol: 'AAPL',
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
      symbol: 'AAPL',
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
      syncedHoldings: 2,
      zeroedHoldings: 0,
      syncError: null,
    });
  });

  it('감시가 꺼져 있으면 원장에도 남기지 않는다', async () => {
    const repository = makeRepository();
    const syncHoldings = makeSyncHoldings();

    const result = await makeTask(
      { fetchDailyBars: jest.fn() },
      repository,
      { id: 'stock-monitor', targetMarketCountry: 'KR' },
      'false',
      syncHoldings,
    ).run(context);

    expect(result.skip).toBe(true);
    expect(recordedRuns).toHaveLength(0);
    // 게이트가 조회보다 앞이어야 한다 — 꺼둔 기능이 DB 를 건드리면 안 된다
    expect(repository.findCurrentHoldings).not.toHaveBeenCalled();
    expect(syncHoldings.execute).not.toHaveBeenCalled();
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

  it('일부만 실패하면 예외로 올리지 않는다 — 나머지를 처리했으므로 실행은 성공이다', async () => {
    const marketData = {
      fetchDailyBars: jest
        .fn()
        .mockResolvedValueOnce([bar('2026-07-21', 100), bar('2026-07-22', 100)])
        .mockRejectedValueOnce(new Error('timeout')),
    };
    const repository = makeRepository();
    repository.findLatestStoredTradeDate.mockResolvedValue(
      new Date('2026-07-21T00:00:00.000Z'),
    );

    const result = await makeTask(marketData, repository).run(context);

    // 전체 실패와의 경계 — 한 종목이라도 점검했으면 SUCCEEDED 로 남고 실패는 요약에 실린다.
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('수집 실패');
    expect(recordedRuns).toHaveLength(1);
    expect(recordedRuns[0].output).toMatchObject({
      holdingCount: 2,
      checkedCount: 1,
      failureCount: 1,
    });
  });

  it('전부 실패하면 예외를 올려 원장이 FAILED 로 기록되게 한다', async () => {
    const marketData = {
      fetchDailyBars: jest.fn().mockRejectedValue(new Error('timeout')),
    };
    const repository = makeRepository();

    await expect(makeTask(marketData, repository).run(context)).rejects.toThrow(
      '보유 2종목을 한 건도 점검하지 못했습니다',
    );
    // 실패 종목이 메시지에 실려야 orchestrator 요약("⚠️ … 자동 생성 실패")에서 원인이 보인다.
    await expect(makeTask(marketData, repository).run(context)).rejects.toThrow(
      '005930',
    );
  });
});
