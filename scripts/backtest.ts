import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { ReplayBacktestUsecase } from '../src/backtest/application/replay-backtest.usecase';
import { BacktestModule } from '../src/backtest/backtest.module';
import { formatBacktestResult } from '../src/backtest/infrastructure/backtest.formatter';
import { parseBacktestCliArguments } from '../src/backtest/interface/backtest-cli.parser';
import { PrismaModule } from '../src/prisma/prisma.module';
import { ResolveStrategyParametersUsecase } from '../src/strategy-parameter/application/resolve-strategy-parameters.usecase';
import { StrategyParameterModule } from '../src/strategy-parameter/strategy-parameter.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BacktestModule,
    StrategyParameterModule,
  ],
})
class BacktestCliModule {}

const main = async (): Promise<void> => {
  const options = parseBacktestCliArguments(process.argv.slice(2));
  const application =
    await NestFactory.createApplicationContext(BacktestCliModule);
  try {
    // 인자로 명시하지 않은 값만 활성 행에서 가져온다. 심판이 운영과 다른 값으로 재면
    // 백테스트 성적이 운영이 실제로 하는 일의 성적이 아니게 된다.
    const parameters = await application
      .get(ResolveStrategyParametersUsecase)
      .execute(options.strategy, {
        minimumTurnover60: options.minimumTurnover60,
        maximumWeightPercent: options.weightPercent,
      });
    const result = await application.get(ReplayBacktestUsecase).execute({
      ...options,
      minimumTurnover60: parameters.minimumTurnover60,
      weightPercent: parameters.maximumWeightPercent,
    });
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
