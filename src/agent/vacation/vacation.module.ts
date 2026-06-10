import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { CalculateBalanceUsecase } from './application/calculate-balance.usecase';
import { CancelLeaveUsecase } from './application/cancel-leave.usecase';
import { ListUsageUsecase } from './application/list-usage.usecase';
import { RegisterLeaveUsecase } from './application/register-leave.usecase';
import { LeaveUsageRepository } from './infrastructure/leave-usage.repository';

// PrismaModule 은 @Global() — 별도 import 불필요.
// ConfigModule 은 AppModule 에서 isGlobal: true — 별도 import 불필요.
@Module({
  imports: [AgentRunModule],
  providers: [
    LeaveUsageRepository,
    CalculateBalanceUsecase,
    RegisterLeaveUsecase,
    ListUsageUsecase,
    CancelLeaveUsecase,
  ],
  exports: [
    CalculateBalanceUsecase,
    RegisterLeaveUsecase,
    ListUsageUsecase,
    CancelLeaveUsecase,
  ],
})
export class VacationModule {}
