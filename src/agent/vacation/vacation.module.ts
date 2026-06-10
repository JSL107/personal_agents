import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { CalculateBalanceUsecase } from './application/calculate-balance.usecase';
import { CancelLeaveUsecase } from './application/cancel-leave.usecase';
import { ListUsageUsecase } from './application/list-usage.usecase';
import { RegisterLeaveUsecase } from './application/register-leave.usecase';
import { LeaveUsageRepository } from './infrastructure/leave-usage.repository';
import { VacationDispatcher } from './infrastructure/vacation.dispatcher';

// PrismaModule 은 @Global() — 별도 import 불필요.
// ConfigModule 은 AppModule 에서 isGlobal: true — 별도 import 불필요.
@Module({
  imports: [AgentRunModule, ModelRouterModule],
  providers: [
    LeaveUsageRepository,
    CalculateBalanceUsecase,
    RegisterLeaveUsecase,
    ListUsageUsecase,
    CancelLeaveUsecase,
    VacationDispatcher,
  ],
  exports: [
    CalculateBalanceUsecase,
    RegisterLeaveUsecase,
    ListUsageUsecase,
    CancelLeaveUsecase,
    VacationDispatcher,
  ],
})
export class VacationModule {}
