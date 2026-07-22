import { Prisma } from '@prisma/client';

import { BrokerHolding } from '../../../market-data/domain/broker-holdings.type';
import { BrokerHoldingsPort } from '../../../market-data/domain/port/broker-holdings.port';
import { StockMonitorRepository } from '../infrastructure/stock-monitor.repository';
import { SyncHoldingsUsecase } from './sync-holdings.usecase';

const createHolding = (
  overrides: Partial<BrokerHolding> = {},
): BrokerHolding => ({
  symbol: '005930',
  name: '삼성전자',
  marketCountry: 'KR',
  currency: 'KRW',
  quantity: new Prisma.Decimal('100'),
  averagePurchasePrice: new Prisma.Decimal('65000'),
  lastPrice: new Prisma.Decimal('72000'),
  ...overrides,
});

describe('SyncHoldingsUsecase', () => {
  const fetchHoldings = jest.fn();
  const upsertTickerFromBroker = jest.fn();
  const upsertHolding = jest.fn();
  const findCurrentBrokerHoldings = jest.fn();
  let usecase: SyncHoldingsUsecase;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T15:30:00.000Z'));
    usecase = new SyncHoldingsUsecase(
      { fetchHoldings } as BrokerHoldingsPort,
      {
        upsertTickerFromBroker,
        upsertHolding,
        findCurrentBrokerHoldings,
      } as unknown as StockMonitorRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('토스 보유 종목을 Ticker와 오늘 Holding으로 upsert한다', async () => {
    fetchHoldings.mockResolvedValue([createHolding()]);
    upsertTickerFromBroker.mockResolvedValue(11);
    findCurrentBrokerHoldings.mockResolvedValue([]);

    const result = await usecase.execute();

    expect(upsertTickerFromBroker).toHaveBeenCalledWith({
      code: '005930',
      market: 'KR',
      marketCountry: 'KR',
      tossSymbol: '005930',
      name: '삼성전자',
      currency: 'KRW',
    });
    expect(upsertHolding).toHaveBeenCalledWith({
      tickerId: 11,
      effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
      quantity: '100',
      avgPrice: '65000',
      currency: 'KRW',
    });
    expect(result).toEqual({ synced: 1, zeroed: 0 });
  });

  it('응답에서 사라진 기존 토스 보유 종목을 삭제하지 않고 수량 0으로 upsert한다', async () => {
    fetchHoldings.mockResolvedValue([
      createHolding({
        symbol: 'AAPL',
        name: 'Apple',
        marketCountry: 'US',
        currency: 'USD',
      }),
    ]);
    upsertTickerFromBroker.mockResolvedValue(21);
    findCurrentBrokerHoldings.mockResolvedValue([
      {
        tickerId: 21,
        avgPrice: new Prisma.Decimal('190.125'),
        currency: 'USD',
      },
      {
        tickerId: 99,
        avgPrice: new Prisma.Decimal('65000'),
        currency: 'KRW',
      },
    ]);

    const result = await usecase.execute();

    expect(upsertHolding).toHaveBeenCalledWith({
      tickerId: 99,
      effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
      quantity: '0',
      avgPrice: '65000',
      currency: 'KRW',
    });
    expect(upsertHolding).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ synced: 1, zeroed: 1 });
  });

  it('보유 응답이 비어 있으면 기존 토스 보유 종목을 모두 수량 0으로 만든다', async () => {
    fetchHoldings.mockResolvedValue([]);
    findCurrentBrokerHoldings.mockResolvedValue([
      {
        tickerId: 99,
        avgPrice: new Prisma.Decimal('65000'),
        currency: 'KRW',
      },
    ]);

    const result = await usecase.execute();

    expect(upsertTickerFromBroker).not.toHaveBeenCalled();
    expect(upsertHolding).toHaveBeenCalledWith({
      tickerId: 99,
      effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
      quantity: '0',
      avgPrice: '65000',
      currency: 'KRW',
    });
    expect(result).toEqual({ synced: 0, zeroed: 1 });
  });
});
