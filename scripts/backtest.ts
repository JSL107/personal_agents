import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { ReplayBacktestUsecase } from '../src/backtest/application/replay-backtest.usecase';
import { BacktestModule } from '../src/backtest/backtest.module';
import { formatBacktestResult } from '../src/backtest/infrastructure/backtest.formatter';
import { parseBacktestCliArguments } from '../src/backtest/interface/backtest-cli.parser';
import { PrismaModule } from '../src/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BacktestModule,
  ],
})
class BacktestCliModule {}

const main = async (): Promise<void> => {
  const command = parseBacktestCliArguments(process.argv.slice(2));
  const application =
    await NestFactory.createApplicationContext(BacktestCliModule);
  try {
    const result = await application
      .get(ReplayBacktestUsecase)
      .execute(command);
    console.log(formatBacktestResult(result));
    // 불변식이 깨진 성적은 규칙의 성적이 아니라 버그의 성적이다.
    // 스크립트로 엮었을 때 조용히 통과하지 않도록 종료 코드로도 알린다.
    if (result.invariantViolations.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
