import { Module } from '@nestjs/common';

import { MARKET_DATA_PORT } from './domain/port/market-data.port';
import { YahooFinanceMarketDataClient } from './infrastructure/yahoo-finance.market-data.client';

@Module({
  providers: [
    { provide: MARKET_DATA_PORT, useClass: YahooFinanceMarketDataClient },
  ],
  exports: [MARKET_DATA_PORT],
})
export class MarketDataModule {}
