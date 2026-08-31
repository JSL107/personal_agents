import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BackfillUniversePricesUsecase } from './application/backfill-universe-prices.usecase';
import { BuildScreeningScorecardUsecase } from './application/build-screening-scorecard.usecase';
import { CollectBenchmarkClosesUsecase } from './application/collect-benchmark-closes.usecase';
import { CollectUniversePricesUsecase } from './application/collect-universe-prices.usecase';
import { ScoreScreeningOutcomesUsecase } from './application/score-screening-outcomes.usecase';
import { ScreenUniverseUsecase } from './application/screen-universe.usecase';
import { SyncUniverseUsecase } from './application/sync-universe.usecase';
import { ScreeningHistoryPrismaRepository } from './infrastructure/screening-history.prisma.repository';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [
    ScreeningHistoryPrismaRepository,
    BuildScreeningScorecardUsecase,
    SyncUniverseUsecase,
    CollectBenchmarkClosesUsecase,
    CollectUniversePricesUsecase,
    BackfillUniversePricesUsecase,
    ScreenUniverseUsecase,
    ScoreScreeningOutcomesUsecase,
  ],
  exports: [
    BuildScreeningScorecardUsecase,
    SyncUniverseUsecase,
    CollectBenchmarkClosesUsecase,
    CollectUniversePricesUsecase,
    BackfillUniversePricesUsecase,
    ScreenUniverseUsecase,
    ScoreScreeningOutcomesUsecase,
  ],
})
export class ScreenerModule {}
