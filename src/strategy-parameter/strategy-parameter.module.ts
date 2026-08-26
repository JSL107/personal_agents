import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ResolveStrategyParametersUsecase } from './application/resolve-strategy-parameters.usecase';
import { STRATEGY_PARAMETER_PORT } from './domain/port/strategy-parameter.port';
import { StrategyParameterPrismaRepository } from './infrastructure/strategy-parameter.prisma.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    StrategyParameterPrismaRepository,
    {
      provide: STRATEGY_PARAMETER_PORT,
      useExisting: StrategyParameterPrismaRepository,
    },
    ResolveStrategyParametersUsecase,
  ],
  exports: [
    ResolveStrategyParametersUsecase,
    StrategyParameterPrismaRepository,
  ],
})
export class StrategyParameterModule {}
