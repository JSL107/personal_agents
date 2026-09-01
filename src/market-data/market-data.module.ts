import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { BROKER_HOLDINGS_PORT } from './domain/port/broker-holdings.port';
import { MARKET_DATA_PORT } from './domain/port/market-data.port';
import { MARKET_INDICATOR_PORT } from './domain/port/market-indicator.port';
import { BenchmarkPrismaRepository } from './infrastructure/benchmark.prisma.repository';
import { KrxDelistingClient } from './infrastructure/krx/krx-delisting.client';
import { KrxListingClient } from './infrastructure/krx/krx-listing.client';
import { MarketDataPrismaRepository } from './infrastructure/market-data.prisma.repository';
import { TossApiClient } from './infrastructure/toss/toss-api.client';
import { TossInvestClient } from './infrastructure/toss/toss-invest.client';
import { TossMarketDataClient } from './infrastructure/toss/toss-market-data.client';
import { TossMarketIndicatorClient } from './infrastructure/toss/toss-market-indicator.client';
import { YahooFinanceMarketDataClient } from './infrastructure/yahoo-finance.market-data.client';

@Module({
  imports: [PrismaModule],
  providers: [
    TossApiClient,
    KrxDelistingClient,
    KrxListingClient,
    MarketDataPrismaRepository,
    BenchmarkPrismaRepository,
    YahooFinanceMarketDataClient,
    { provide: MARKET_DATA_PORT, useClass: TossMarketDataClient },
    {
      provide: MARKET_INDICATOR_PORT,
      useClass: TossMarketIndicatorClient,
    },
    { provide: BROKER_HOLDINGS_PORT, useClass: TossInvestClient },
  ],
  exports: [
    MARKET_DATA_PORT,
    MARKET_INDICATOR_PORT,
    BROKER_HOLDINGS_PORT,
    KrxDelistingClient,
    KrxListingClient,
    MarketDataPrismaRepository,
    BenchmarkPrismaRepository,
  ],
})
export class MarketDataModule {}
