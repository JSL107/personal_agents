import { KrxListingClient } from '../../market-data/infrastructure/krx/krx-listing.client';
import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import { SyncUniverseUsecase } from './sync-universe.usecase';

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
    const repository = {
      upsertUniverseTickers: jest.fn().mockResolvedValue(1_000),
      markDelistedExcept: jest.fn().mockResolvedValue(3),
    } as unknown as MarketDataRepository;
    const usecase = new SyncUniverseUsecase(client, repository);

    await expect(usecase.execute()).resolves.toEqual({
      fetched: 1_000,
      upserted: 1_000,
      delisted: 3,
    });
    expect(repository.markDelistedExcept).toHaveBeenCalledWith(
      listings.map((listing) => listing.code),
      expect.any(Date),
    );
  });

  it('상장폐지 안전 하한이 발동하면 실패한다', async () => {
    const client = {
      fetchListings: jest.fn().mockResolvedValue([]),
    } as unknown as KrxListingClient;
    const repository = {
      upsertUniverseTickers: jest.fn().mockResolvedValue(0),
      markDelistedExcept: jest.fn().mockResolvedValue(-1),
    } as unknown as MarketDataRepository;
    const usecase = new SyncUniverseUsecase(client, repository);

    await expect(usecase.execute()).rejects.toThrow(
      '유니버스 상장폐지 안전 하한',
    );
  });
});
