import { Prisma } from '@prisma/client';

import { BrokerHolding } from '../../../market-data/domain/broker-holdings.type';
import { BrokerHoldingsPort } from '../../../market-data/domain/port/broker-holdings.port';
import { HoldingPosition } from '../domain/holding-change';
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

// 직전 스냅샷 한 줄. findCurrentBrokerHoldings 의 실제 반환 모양(HoldingPosition)을 그대로 쓴다 —
// 수량이 빠진 mock 은 매매 판정을 조용히 무력화한다.
const createPosition = (
  overrides: Partial<HoldingPosition> = {},
): HoldingPosition => ({
  tickerId: 11,
  tickerName: '삼성전자',
  symbol: '005930',
  quantity: new Prisma.Decimal('100'),
  avgPrice: new Prisma.Decimal('65000'),
  currency: 'KRW',
  ...overrides,
});

describe('SyncHoldingsUsecase', () => {
  const fetchHoldings = jest.fn();
  const upsertTickerFromBroker = jest.fn();
  const upsertHolding = jest.fn();
  const findCurrentBrokerHoldings = jest.fn();
  const recordHoldingChanges = jest.fn();
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
        recordHoldingChanges,
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
    expect(result).toMatchObject({ synced: 1, zeroed: 0 });
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
      createPosition({
        tickerId: 21,
        tickerName: 'Apple',
        symbol: 'AAPL',
        currency: 'USD',
      }),
      createPosition({ tickerId: 99, tickerName: '삼전', symbol: '005930' }),
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
    expect(result).toMatchObject({ synced: 1, zeroed: 1 });
  });

  it('보유 응답이 비어 있으면 기존 토스 보유 종목을 모두 수량 0으로 만든다', async () => {
    fetchHoldings.mockResolvedValue([]);
    findCurrentBrokerHoldings.mockResolvedValue([
      createPosition({ tickerId: 99 }),
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
    expect(result).toMatchObject({ synced: 0, zeroed: 1 });
    // 이 시나리오의 핵심 산출물. 배선이 빠져도 synced·zeroed 만 보면 통과한다.
    expect(result.changes).toEqual([
      {
        tickerId: 99,
        tickerName: '삼성전자',
        symbol: '005930',
        kind: 'SOLD_ALL',
        previousQuantity: '100',
        quantity: '0',
        previousAvgPrice: '65000',
        avgPrice: '65000',
        currency: 'KRW',
      },
    ]);
    expect(recordHoldingChanges).toHaveBeenCalledWith([
      {
        tickerId: 99,
        kind: 'SOLD_ALL',
        previousQuantity: '100',
        quantity: '0',
        previousAvgPrice: '65000',
        avgPrice: '65000',
        currency: 'KRW',
        effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it('직전 잔고를 새 값으로 덮어쓰기 전에 읽어 비교 기준선으로 쓴다', async () => {
    fetchHoldings.mockResolvedValue([createHolding()]);
    upsertTickerFromBroker.mockResolvedValue(11);
    findCurrentBrokerHoldings.mockResolvedValue([]);

    await usecase.execute();

    expect(findCurrentBrokerHoldings.mock.invocationCallOrder[0]).toBeLessThan(
      upsertHolding.mock.invocationCallOrder[0],
    );
  });

  it('감지한 매매를 결과에 담고 전용 표에 적재한다', async () => {
    fetchHoldings.mockResolvedValue([
      createHolding({ quantity: new Prisma.Decimal('180') }),
    ]);
    upsertTickerFromBroker.mockResolvedValue(11);
    findCurrentBrokerHoldings.mockResolvedValue([
      createPosition({ tickerId: 11 }),
    ]);

    const result = await usecase.execute();

    expect(result.changes).toEqual([
      expect.objectContaining({
        tickerId: 11,
        kind: 'INCREASED',
        previousQuantity: '100',
        quantity: '180',
      }),
    ]);
    expect(recordHoldingChanges).toHaveBeenCalledWith([
      {
        tickerId: 11,
        kind: 'INCREASED',
        previousQuantity: '100',
        quantity: '180',
        previousAvgPrice: '65000',
        avgPrice: '65000',
        currency: 'KRW',
        effectiveDate: new Date('2026-07-22T00:00:00.000Z'),
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  // 사건이 스냅샷보다 먼저 남아야 한다. 스냅샷을 먼저 덮어쓰면 그 뒤 적재가 실패했을 때
  // 재실행이 "변화 없음"으로 판정해 그 매매가 영구히 사라진다.
  it('스냅샷을 덮어쓰기 전에 사건을 적재한다', async () => {
    fetchHoldings.mockResolvedValue([
      createHolding({ quantity: new Prisma.Decimal('180') }),
    ]);
    upsertTickerFromBroker.mockResolvedValue(11);
    findCurrentBrokerHoldings.mockResolvedValue([
      createPosition({ tickerId: 11 }),
      createPosition({ tickerId: 99, symbol: '000660' }),
    ]);

    await usecase.execute();

    const firstUpsertOrder = Math.min(
      ...upsertHolding.mock.invocationCallOrder,
    );
    expect(recordHoldingChanges.mock.invocationCallOrder[0]).toBeLessThan(
      firstUpsertOrder,
    );
  });

  // 적재가 실패하면 스냅샷은 그대로여야 한다 — 그래야 재실행이 같은 사건을 다시 계산해 복구한다.
  it('사건 적재가 실패하면 스냅샷을 갱신하지 않고 실패를 올린다', async () => {
    fetchHoldings.mockResolvedValue([
      createHolding({ quantity: new Prisma.Decimal('180') }),
    ]);
    upsertTickerFromBroker.mockResolvedValue(11);
    findCurrentBrokerHoldings.mockResolvedValue([
      createPosition({ tickerId: 11 }),
    ]);
    // Once — clearAllMocks 는 호출 기록만 지우고 구현은 남기므로, 이 거부가 다음 테스트로 샌다.
    recordHoldingChanges.mockRejectedValueOnce(new Error('DB down'));

    await expect(usecase.execute()).rejects.toThrow('DB down');

    expect(upsertHolding).not.toHaveBeenCalled();
  });

  it('변화가 없으면 결과에 빈 목록을 담고 적재를 호출하되 아무 행도 넘기지 않는다', async () => {
    fetchHoldings.mockResolvedValue([createHolding()]);
    upsertTickerFromBroker.mockResolvedValue(11);
    findCurrentBrokerHoldings.mockResolvedValue([
      createPosition({ tickerId: 11 }),
    ]);

    const result = await usecase.execute();

    expect(result.changes).toEqual([]);
    expect(recordHoldingChanges).toHaveBeenCalledWith([]);
  });
});
