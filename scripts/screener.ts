import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PrismaModule } from '../src/prisma/prisma.module';
import {
  CollectPricesOptions,
  CollectUniversePricesUsecase,
} from '../src/screener/application/collect-universe-prices.usecase';
import {
  RankCandidatesOptions,
  RankCandidatesUsecase,
} from '../src/screener/application/rank-candidates.usecase';
import { SyncUniverseUsecase } from '../src/screener/application/sync-universe.usecase';
import { formatCandidates } from '../src/screener/infrastructure/candidate.formatter';
import { formatPriceCollectionFailures } from '../src/screener/infrastructure/price-collection-failure.formatter';
import { ScreenerModule } from '../src/screener/screener.module';

const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/screener.ts sync-universe\n' +
  '  pnpm exec ts-node scripts/screener.ts collect-prices [--days <봉수>] [--limit <종목수>]\n' +
  '  pnpm exec ts-node scripts/screener.ts rank [--limit <후보수>]';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ScreenerModule,
  ],
})
class ScreenerCliModule {}

type Subcommand = 'sync-universe' | 'collect-prices' | 'rank';

interface ParsedArguments {
  subcommand: Subcommand;
  options: CollectPricesOptions & RankCandidatesOptions;
}

const parsePositiveInteger = (value: string, key: string): number => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`--${key}는 양의 정수여야 합니다.\n${USAGE}`);
  }
  return Number(value);
};

const parseArguments = (values: string[]): ParsedArguments => {
  const [subcommandValue, ...optionValues] = values;
  if (
    subcommandValue !== 'sync-universe' &&
    subcommandValue !== 'collect-prices' &&
    subcommandValue !== 'rank'
  ) {
    throw new Error(USAGE);
  }
  if (subcommandValue === 'sync-universe') {
    if (optionValues.length > 0) {
      throw new Error(USAGE);
    }
    return { subcommand: subcommandValue, options: {} };
  }
  if (subcommandValue === 'rank') {
    if (optionValues.length === 0) {
      return { subcommand: subcommandValue, options: {} };
    }
    if (optionValues.length !== 2 || optionValues[0] !== '--limit') {
      throw new Error(USAGE);
    }
    return {
      subcommand: subcommandValue,
      options: { limit: parsePositiveInteger(optionValues[1], 'limit') },
    };
  }

  const options: CollectPricesOptions = {};
  for (let index = 0; index < optionValues.length; index += 2) {
    const key = optionValues[index];
    const value = optionValues[index + 1];
    if (
      (key !== '--days' && key !== '--limit') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(USAGE);
    }
    const parsed = parsePositiveInteger(value, key.slice(2));
    if (key === '--days') {
      options.days = parsed;
    } else {
      options.limit = parsed;
    }
  }
  return { subcommand: subcommandValue, options };
};

const main = async (): Promise<void> => {
  const parsed = parseArguments(process.argv.slice(2));
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

    if (parsed.subcommand === 'rank') {
      const result = await application
        .get(RankCandidatesUsecase)
        .execute(parsed.options);
      console.log(formatCandidates(result));
      return;
    }

    const result = await application
      .get(CollectUniversePricesUsecase)
      .execute(parsed.options);
    console.log(
      `유니버스 시세 수집을 마쳤습니다. 대상 ${result.targetCount}종목 중 ${result.succeeded}종목 성공, ${result.failed}종목 실패, 일봉 ${result.written}건 저장, 장중 ${result.blockedIntraday}건 차단, 조정가 ${result.readjusted}종목 재수집했습니다.`,
    );
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
