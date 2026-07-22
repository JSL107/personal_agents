import { Module } from '@nestjs/common';

import { MarketDataModule } from '../../market-data/market-data.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SyncHoldingsUsecase } from './application/sync-holdings.usecase';
import { StockMonitorRepository } from './infrastructure/stock-monitor.repository';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [StockMonitorRepository, SyncHoldingsUsecase],
  exports: [StockMonitorRepository, SyncHoldingsUsecase],
})
export class StockModule {}
