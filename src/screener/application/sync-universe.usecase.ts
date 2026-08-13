import { Injectable } from '@nestjs/common';

import { KrxListingClient } from '../../market-data/infrastructure/krx/krx-listing.client';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';

export interface SyncUniverseResult {
  fetched: number;
  upserted: number;
  delisted: number;
}

@Injectable()
export class SyncUniverseUsecase {
  constructor(
    private readonly krxListingClient: KrxListingClient,
    private readonly repository: MarketDataPrismaRepository,
  ) {}

  async execute(): Promise<SyncUniverseResult> {
    const listings = await this.krxListingClient.fetchListings();
    const upserted = await this.repository.upsertUniverseTickers(listings);
    const asOf = new Date();
    asOf.setUTCHours(0, 0, 0, 0);
    const delisted = await this.repository.markDelistedExcept(
      listings.map((listing) => listing.code),
      asOf,
    );
    if (delisted < 0) {
      throw new Error(
        `유니버스 상장폐지 안전 하한 발동 — 활성 종목 ${listings.length}건`,
      );
    }
    return { fetched: listings.length, upserted, delisted };
  }
}
