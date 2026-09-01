import { KrxDelistingClient } from '../../market-data/infrastructure/krx/krx-delisting.client';
import { KrxListingClient } from '../../market-data/infrastructure/krx/krx-listing.client';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';
import { SyncUniverseUsecase } from './sync-universe.usecase';

const delistingClientOf = (
  overrides?: Partial<KrxDelistingClient>,
): KrxDelistingClient => {
  return {
    fetchDelistings: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as KrxDelistingClient;
};

describe('SyncUniverseUsecase', () => {
  it('KRX 목록을 upsert하고 목록 밖 KRX 종목을 상장폐지 처리한다', async () => {
    const listings = Array.from({ length: 1_000 }, (_, index) => ({
      code: String(index).padStart(6, '0'),
      name: `종목${index}`,
      market: 'KOSPI' as const,
      sector: null,
      listedAt: null,
    }));
    const client = {
      fetchListings: jest.fn().mockResolvedValue(listings),
    } as unknown as KrxListingClient;
    const delistings = [
      {
        code: '000001',
        name: '종목1',
        market: 'KOSPI' as const,
        delistedAt: new Date('2026-08-18T00:00:00.000Z'),
        reason: '피흡수합병',
      },
    ];
    const delistingClient = delistingClientOf({
      fetchDelistings: jest.fn().mockResolvedValue(delistings),
    });
    const repository = {
      upsertUniverseTickers: jest.fn().mockResolvedValue(1_000),
      markDelistedExcept: jest.fn().mockResolvedValue(3),
      applyDelistingHistory: jest.fn().mockResolvedValue(1),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new SyncUniverseUsecase(
      client,
      delistingClient,
      repository,
    );

    await expect(usecase.execute()).resolves.toEqual({
      fetched: 1_000,
      upserted: 1_000,
      delisted: 3,
      delistingHistory: { applied: 1 },
    });
    expect(repository.markDelistedExcept).toHaveBeenCalledWith(
      listings.map((listing) => listing.code),
      expect.any(Date),
    );
    expect(repository.applyDelistingHistory).toHaveBeenCalledWith(delistings);
  });

  it('상장폐지 안전 하한이 발동하면 실패한다', async () => {
    const client = {
      fetchListings: jest.fn().mockResolvedValue([]),
    } as unknown as KrxListingClient;
    const repository = {
      upsertUniverseTickers: jest.fn().mockResolvedValue(0),
      markDelistedExcept: jest.fn().mockResolvedValue(-1),
      applyDelistingHistory: jest.fn(),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new SyncUniverseUsecase(
      client,
      delistingClientOf(),
      repository,
    );

    await expect(usecase.execute()).rejects.toThrow(
      '유니버스 상장폐지 안전 하한',
    );
    // 하한이 발동하면 유니버스가 신뢰할 수 없는 상태이므로 이력 반영까지 가지 않는다.
    expect(repository.applyDelistingHistory).not.toHaveBeenCalled();
  });

  it('상장폐지 이력 조회가 실패하면 유니버스 갱신은 유지하되 실패를 결과에 남긴다', async () => {
    const listings = Array.from({ length: 1_000 }, (_, index) => ({
      code: String(index).padStart(6, '0'),
      name: `종목${index}`,
      market: 'KOSPI' as const,
      sector: null,
      listedAt: null,
    }));
    const client = {
      fetchListings: jest.fn().mockResolvedValue(listings),
    } as unknown as KrxListingClient;
    const delistingClient = delistingClientOf({
      fetchDelistings: jest
        .fn()
        .mockRejectedValue(new Error('KIND 상장폐지 목록 요청 실패: HTTP 503')),
    });
    const repository = {
      upsertUniverseTickers: jest.fn().mockResolvedValue(1_000),
      markDelistedExcept: jest.fn().mockResolvedValue(0),
      applyDelistingHistory: jest.fn(),
    } as unknown as MarketDataPrismaRepository;
    const usecase = new SyncUniverseUsecase(
      client,
      delistingClient,
      repository,
    );

    await expect(usecase.execute()).resolves.toEqual({
      fetched: 1_000,
      upserted: 1_000,
      delisted: 0,
      delistingHistory: {
        error: 'KIND 상장폐지 목록 요청 실패: HTTP 503',
      },
    });
    expect(repository.applyDelistingHistory).not.toHaveBeenCalled();
  });
});
