import { Module } from '@nestjs/common';

import { BacktestModule } from '../backtest/backtest.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StrategyParameterModule } from '../strategy-parameter/strategy-parameter.module';
import { EvaluateProbationService } from './application/evaluate-probation.service';
import { RunParamTuneUsecase } from './application/run-param-tune.usecase';
import { PARAM_TUNE_RUN_PORT } from './domain/port/param-tune-run.port';
import { ParamTuneRunPrismaRepository } from './infrastructure/param-tune-run.prisma.repository';

// 자식 프로세스 전용 모듈이다. AppModule 에 등록하지 않는다 — 탐색은 수십 분짜리 재생이라
// 서버 프로세스 안에서 돌면 안 된다.
@Module({
  imports: [PrismaModule, BacktestModule, StrategyParameterModule],
  providers: [
    ParamTuneRunPrismaRepository,
    {
      provide: PARAM_TUNE_RUN_PORT,
      useExisting: ParamTuneRunPrismaRepository,
    },
    EvaluateProbationService,
    RunParamTuneUsecase,
  ],
  exports: [RunParamTuneUsecase],
})
export class ParamTuneModule {}
