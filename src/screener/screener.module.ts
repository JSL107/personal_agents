import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectUniversePricesUsecase } from './application/collect-universe-prices.usecase';
import { RankCandidatesUsecase } from './application/rank-candidates.usecase';
import { SyncUniverseUsecase } from './application/sync-universe.usecase';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [
    SyncUniverseUsecase,
    CollectUniversePricesUsecase,
    RankCandidatesUsecase,
  ],
  exports: [
    SyncUniverseUsecase,
    CollectUniversePricesUsecase,
    RankCandidatesUsecase,
  ],
})
export class ScreenerModule {}
