import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ReplayBacktestUsecase } from './application/replay-backtest.usecase';
import { BacktestPrismaRepository } from './infrastructure/backtest.prisma.repository';

// CLI 전용 모듈이다. AppModule 에 등록하지 않는다 — 서버가 뜰 때 쓸 일이 없고,
// 등록하면 백테스트가 운영 서버의 기동 시간과 메모리를 쓰게 된다.
@Module({
  imports: [PrismaModule],
  providers: [BacktestPrismaRepository, ReplayBacktestUsecase],
  exports: [ReplayBacktestUsecase],
})
export class BacktestModule {}
