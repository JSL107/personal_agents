import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { PrismaModule } from '../src/prisma/prisma.module';
import { STRATEGY_PARAMETER_SEEDS } from '../src/strategy-parameter/domain/strategy-parameter.seed';
import {
  STRATEGY_PARAMETER_FALLBACKS,
  StrategyParameterStrategy,
} from '../src/strategy-parameter/domain/strategy-parameter.type';
import { StrategyParameterPrismaRepository } from '../src/strategy-parameter/infrastructure/strategy-parameter.prisma.repository';
import { StrategyParameterModule } from '../src/strategy-parameter/strategy-parameter.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StrategyParameterModule,
  ],
})
class StrategyParameterCliModule {}

const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/strategy-parameter.ts list\n' +
  '  pnpm exec ts-node scripts/strategy-parameter.ts seed';

const STRATEGIES: StrategyParameterStrategy[] = ['LONG_TERM', 'SWING'];

const runList = async (
  repository: StrategyParameterPrismaRepository,
): Promise<void> => {
  for (const strategy of STRATEGIES) {
    const active = await repository.findActiveParameters(strategy);
    console.log(`\n[${strategy}]`);
    if (active.length === 0) {
      console.log('  활성 행 없음 — 코드 상수로 돈다.');
    }
    const activeByName = new Map(
      active.map((parameter) => [parameter.name, parameter]),
    );
    for (const name of Object.keys(STRATEGY_PARAMETER_FALLBACKS) as Array<
      keyof typeof STRATEGY_PARAMETER_FALLBACKS
    >) {
      const found = activeByName.get(name);
      if (found === undefined) {
        console.log(
          `  ${name} = ${STRATEGY_PARAMETER_FALLBACKS[name]} (코드 상수 — 활성 행 없음)`,
        );
        continue;
      }
      console.log(`  ${name} = ${found.value} (v${found.version})`);
    }
  }
};

const runSeed = async (
  repository: StrategyParameterPrismaRepository,
): Promise<void> => {
  const outcome = await repository.seedMissingParameters(
    STRATEGY_PARAMETER_SEEDS,
  );
  console.log(`삽입 ${outcome.inserted.length}건`);
  for (const label of outcome.inserted) {
    console.log(`  + ${label}`);
  }
  console.log(`건너뜀 ${outcome.skipped.length}건 (이미 활성 행 있음)`);
  for (const label of outcome.skipped) {
    console.log(`  = ${label}`);
  }
};

const main = async (): Promise<void> => {
  const command = process.argv[2];
  if (command !== 'list' && command !== 'seed') {
    throw new Error(`알 수 없는 명령: ${command ?? '(없음)'}\n${USAGE}`);
  }
  const application = await NestFactory.createApplicationContext(
    StrategyParameterCliModule,
  );
  try {
    const repository = application.get(StrategyParameterPrismaRepository);
    if (command === 'list') {
      await runList(repository);
      return;
    }
    await runSeed(repository);
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
