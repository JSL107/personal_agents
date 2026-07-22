import { ConfigService } from '@nestjs/config';

import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
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

const bar = (tradeDate: string, adjClose: number): DailyBar => ({
  tradeDate: new Date(`${tradeDate}T00:00:00.000Z`),
  close: decimal(adjClose),
  adjClose: decimal(adjClose),
  volume: 100n,
  currency: 'KRW',
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
});

const makeTask = (
  marketData: Pick<MarketDataPort, 'fetchDailyBars'>,
  repository: ReturnType<typeof makeRepository>,
): StockMonitorAutopilotTask =>
  new StockMonitorAutopilotTask(
    marketData as MarketDataPort,
    repository as unknown as StockMonitorRepository,
    { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService,
  );

describe('StockMonitorAutopilotTask', () => {
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
});
