import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { FactAnswerModule } from '../../fact-answer/fact-answer.module';
import { HolidayModule } from '../../holiday/holiday.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { AnswerVacationQuestionUsecase } from './application/answer-vacation-question.usecase';
import { CalculateBalanceUsecase } from './application/calculate-balance.usecase';
import { CancelLeaveUsecase } from './application/cancel-leave.usecase';
import { ListUsageUsecase } from './application/list-usage.usecase';
import { RegisterLeaveUsecase } from './application/register-leave.usecase';
import { LeaveUsagePrismaRepository } from './infrastructure/leave-usage.prisma.repository';
import { VacationDispatcher } from './infrastructure/vacation.dispatcher';

// PrismaModule 은 @Global() — 별도 import 불필요.
// ConfigModule 은 AppModule 에서 isGlobal: true — 별도 import 불필요.
@Module({
  imports: [AgentRunModule, FactAnswerModule, HolidayModule, ModelRouterModule],
  providers: [
    LeaveUsagePrismaRepository,
    CalculateBalanceUsecase,
    RegisterLeaveUsecase,
    ListUsageUsecase,
    CancelLeaveUsecase,
    AnswerVacationQuestionUsecase,
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
