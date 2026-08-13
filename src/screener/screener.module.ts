import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectBenchmarkClosesUsecase } from './application/collect-benchmark-closes.usecase';
import { CollectUniversePricesUsecase } from './application/collect-universe-prices.usecase';
import { ScreenUniverseUsecase } from './application/screen-universe.usecase';
import { SyncUniverseUsecase } from './application/sync-universe.usecase';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [
    SyncUniverseUsecase,
    CollectBenchmarkClosesUsecase,
    CollectUniversePricesUsecase,
    ScreenUniverseUsecase,
  ],
  exports: [
    SyncUniverseUsecase,
    CollectBenchmarkClosesUsecase,
    CollectUniversePricesUsecase,
    ScreenUniverseUsecase,
  ],
})
export class ScreenerModule {}
