import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
import { DecimalValue } from '../../../market-data/domain/market-data.type';
import { StockAlertScoringAutopilotTask } from './stock-alert-scoring.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-23' };

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => value.toString(),
});

const tradeDate = new Date('2026-07-16T00:00:00.000Z');

const makeRepository = () => ({
  findAlertsNeedingOutcome: jest.fn(),
  findDailyPricesSince: jest.fn(),
  upsertAlertOutcome: jest.fn().mockResolvedValue(undefined),
});

const makeTask = (
  repository: ReturnType<typeof makeRepository>,
): StockAlertScoringAutopilotTask =>
  new StockAlertScoringAutopilotTask(
    repository as unknown as StockMonitorRepository,
  );

describe('StockAlertScoringAutopilotTask', () => {
  it('5거래일이 경과한 알림을 채점하고 outcome을 저장한다', async () => {
    const repository = makeRepository();
    repository.findAlertsNeedingOutcome.mockResolvedValue([
      { alertId: 11, tickerId: 3, tradeDate },
    ]);
    repository.findDailyPricesSince.mockResolvedValue([
      { tradeDate, adjClose: decimal(100) },
      { tradeDate: new Date('2026-07-17'), adjClose: decimal(101) },
      { tradeDate: new Date('2026-07-20'), adjClose: decimal(102) },
      { tradeDate: new Date('2026-07-21'), adjClose: decimal(103) },
      { tradeDate: new Date('2026-07-22'), adjClose: decimal(104) },
      { tradeDate: new Date('2026-07-23'), adjClose: decimal(110) },
    ]);

    const result = await makeTask(repository).run(context);

    expect(repository.findAlertsNeedingOutcome).toHaveBeenCalledWith(5);
    expect(repository.findDailyPricesSince).toHaveBeenCalledWith(3, tradeDate);
    expect(repository.upsertAlertOutcome).toHaveBeenCalledWith({
      alertId: 11,
      horizonDays: 5,
      firedPrice: '100',
      horizonPrice: '110',
      returnPct: '10',
    });
    expect(result).toEqual({
      skip: false,
      summaryText: '주식 알림 사후 채점 — 1건 채점',
    });
  });

  it('5거래일이 아직 지나지 않은 알림은 건너뛴다', async () => {
    const repository = makeRepository();
    repository.findAlertsNeedingOutcome.mockResolvedValue([
      { alertId: 11, tickerId: 3, tradeDate },
    ]);
    repository.findDailyPricesSince.mockResolvedValue([
      { tradeDate, adjClose: decimal(100) },
      { tradeDate: new Date('2026-07-17'), adjClose: decimal(101) },
      { tradeDate: new Date('2026-07-20'), adjClose: decimal(102) },
      { tradeDate: new Date('2026-07-21'), adjClose: decimal(103) },
      { tradeDate: new Date('2026-07-22'), adjClose: decimal(104) },
    ]);

    const result = await makeTask(repository).run(context);

    expect(repository.upsertAlertOutcome).not.toHaveBeenCalled();
    expect(result).toEqual({ skip: true });
  });

  it('발화일 가격이 누락되면 이후 가격을 발화가로 오인하지 않는다', async () => {
    const repository = makeRepository();
    repository.findAlertsNeedingOutcome.mockResolvedValue([
      { alertId: 11, tickerId: 3, tradeDate },
    ]);
    repository.findDailyPricesSince.mockResolvedValue([
      { tradeDate: new Date('2026-07-17'), adjClose: decimal(101) },
      { tradeDate: new Date('2026-07-20'), adjClose: decimal(102) },
      { tradeDate: new Date('2026-07-21'), adjClose: decimal(103) },
      { tradeDate: new Date('2026-07-22'), adjClose: decimal(104) },
      { tradeDate: new Date('2026-07-23'), adjClose: decimal(105) },
      { tradeDate: new Date('2026-07-24'), adjClose: decimal(106) },
    ]);

    const result = await makeTask(repository).run(context);

    expect(repository.upsertAlertOutcome).not.toHaveBeenCalled();
    expect(result).toEqual({ skip: true });
  });

  it('이미 채점되어 대상 알림이 없으면 skip한다', async () => {
    const repository = makeRepository();
    repository.findAlertsNeedingOutcome.mockResolvedValue([]);

    const result = await makeTask(repository).run(context);

    expect(repository.findDailyPricesSince).not.toHaveBeenCalled();
    expect(repository.upsertAlertOutcome).not.toHaveBeenCalled();
    expect(result).toEqual({ skip: true });
  });
});
