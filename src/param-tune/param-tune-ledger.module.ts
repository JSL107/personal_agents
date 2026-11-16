import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { PARAM_TUNE_RUN_PORT } from './domain/port/param-tune-run.port';
import { ParamTuneRunPrismaRepository } from './infrastructure/param-tune-run.prisma.repository';

// 탐색 원장 포트만 내놓는 작은 모듈. ParamTuneModule 은 BacktestModule 을 끌고 오는 자식
// 프로세스 전용이라, 서버 쪽(autopilot·paper-trading)은 이 모듈로 포트만 받는다.
@Module({
  imports: [PrismaModule],
  providers: [
    ParamTuneRunPrismaRepository,
    {
      provide: PARAM_TUNE_RUN_PORT,
      useExisting: ParamTuneRunPrismaRepository,
    },
  ],
  exports: [PARAM_TUNE_RUN_PORT],
})
export class ParamTuneLedgerModule {}
