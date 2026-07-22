import { Module } from '@nestjs/common';

import { MarketDataModule } from '../../market-data/market-data.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StockMonitorRepository } from './infrastructure/stock-monitor.repository';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [StockMonitorRepository],
  exports: [StockMonitorRepository],
})
export class StockModule {}
