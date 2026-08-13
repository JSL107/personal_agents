import { Module } from '@nestjs/common';

import { MarketDataModule } from '../../market-data/market-data.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SyncHoldingsUsecase } from './application/sync-holdings.usecase';
import { StockMonitorPrismaRepository } from './infrastructure/stock-monitor.prisma.repository';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [StockMonitorPrismaRepository, SyncHoldingsUsecase],
  exports: [StockMonitorPrismaRepository, SyncHoldingsUsecase],
})
export class StockModule {}
