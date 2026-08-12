import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PrismaModule } from '../src/prisma/prisma.module';
import { CollectUniversePricesUsecase } from '../src/screener/application/collect-universe-prices.usecase';
import { ScreenUniverseUsecase } from '../src/screener/application/screen-universe.usecase';
import { SyncUniverseUsecase } from '../src/screener/application/sync-universe.usecase';
import { formatPriceCollectionFailures } from '../src/screener/infrastructure/price-collection-failure.formatter';
import { formatPriceCollectionSummary } from '../src/screener/infrastructure/price-collection-summary.formatter';
import { formatScreenResult } from '../src/screener/infrastructure/screen-result.formatter';
import { parseScreenerCliArguments } from '../src/screener/interface/screener-cli.parser';
import { ScreenerModule } from '../src/screener/screener.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ScreenerModule,
  ],
})
class ScreenerCliModule {}

const main = async (): Promise<void> => {
  const parsed = parseScreenerCliArguments(process.argv.slice(2));
  const application =
    await NestFactory.createApplicationContext(ScreenerCliModule);
  try {
    if (parsed.subcommand === 'sync-universe') {
      const result = await application.get(SyncUniverseUsecase).execute();
      console.log(
        `KRX 유니버스 동기화를 마쳤습니다. ${result.fetched}종목을 받아 ${result.upserted}종목을 반영했고, 목록에서 빠진 ${result.delisted}종목을 상장폐지 처리했습니다.`,
      );
      return;
    }

    if (parsed.subcommand === 'screen') {
      const result = await application
        .get(ScreenUniverseUsecase)
        .execute(parsed.options);
      console.log(formatScreenResult(result));
      return;
    }

    const result = await application
      .get(CollectUniversePricesUsecase)
      .execute(parsed.options);
    console.log(formatPriceCollectionSummary(result));
    const failureDetail = formatPriceCollectionFailures(
      result.failed,
      result.failures,
    );
    if (failureDetail) {
      console.log(failureDetail);
    }
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
