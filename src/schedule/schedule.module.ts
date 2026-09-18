import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ListSchedulesUsecase } from './application/list-schedules.usecase';
import { RegisterScheduleUsecase } from './application/register-schedule.usecase';
import { UpdateScheduleStatusUsecase } from './application/update-schedule-status.usecase';
import { SCHEDULE_REPOSITORY_PORT } from './domain/port/schedule.repository.port';
import { SchedulePrismaRepository } from './infrastructure/schedule.prisma.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: SCHEDULE_REPOSITORY_PORT, useClass: SchedulePrismaRepository },
    RegisterScheduleUsecase,
    ListSchedulesUsecase,
    UpdateScheduleStatusUsecase,
  ],
  exports: [
    RegisterScheduleUsecase,
    ListSchedulesUsecase,
    UpdateScheduleStatusUsecase,
  ],
})
export class ScheduleModule {}
