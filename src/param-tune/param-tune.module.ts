import { Module } from '@nestjs/common';

import { BacktestModule } from '../backtest/backtest.module';
import { StrategyParameterModule } from '../strategy-parameter/strategy-parameter.module';
import { EvaluateProbationUsecase } from './application/evaluate-probation.usecase';
import { RunParamTuneUsecase } from './application/run-param-tune.usecase';
import { ParamTuneLedgerModule } from './param-tune-ledger.module';

// 자식 프로세스 전용 모듈이다. AppModule 에 등록하지 않는다 — 탐색은 수십 분짜리 재생이라
// 서버 프로세스 안에서 돌면 안 된다.
@Module({
  imports: [ParamTuneLedgerModule, BacktestModule, StrategyParameterModule],
  providers: [EvaluateProbationUsecase, RunParamTuneUsecase],
  exports: [RunParamTuneUsecase],
})
export class ParamTuneModule {}
