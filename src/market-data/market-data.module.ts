import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BROKER_HOLDINGS_PORT } from './domain/port/broker-holdings.port';
import { MARKET_DATA_PORT } from './domain/port/market-data.port';
import { BenchmarkRepository } from './infrastructure/benchmark.repository';
import { KrxListingClient } from './infrastructure/krx/krx-listing.client';
import { MarketDataRepository } from './infrastructure/market-data.repository';
import { TossApiClient } from './infrastructure/toss/toss-api.client';
import { TossInvestClient } from './infrastructure/toss/toss-invest.client';
import { TossMarketDataClient } from './infrastructure/toss/toss-market-data.client';
import { TossMarketIndicatorClient } from './infrastructure/toss/toss-market-indicator.client';
import { YahooFinanceMarketDataClient } from './infrastructure/yahoo-finance.market-data.client';

@Module({
  imports: [PrismaModule],
  providers: [
    TossApiClient,
    KrxListingClient,
    MarketDataRepository,
    BenchmarkRepository,
    TossMarketIndicatorClient,
    YahooFinanceMarketDataClient,
    { provide: MARKET_DATA_PORT, useClass: TossMarketDataClient },
    { provide: BROKER_HOLDINGS_PORT, useClass: TossInvestClient },
  ],
  exports: [
    MARKET_DATA_PORT,
    BROKER_HOLDINGS_PORT,
    KrxListingClient,
    MarketDataRepository,
    BenchmarkRepository,
    TossMarketIndicatorClient,
  ],
})
export class MarketDataModule {}
