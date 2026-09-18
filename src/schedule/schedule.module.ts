import { Module } from '@nestjs/common';

import { LoopbackOnlyGuard } from '../common/guard/loopback-only.guard';
import { ConsoleReadGuard } from '../console/interface/console-read.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { DeleteScheduleUsecase } from './application/delete-schedule.usecase';
import { ListSchedulesUsecase } from './application/list-schedules.usecase';
import { RegisterScheduleUsecase } from './application/register-schedule.usecase';
import { UpdateScheduleStatusUsecase } from './application/update-schedule-status.usecase';
import { SCHEDULE_REPOSITORY_PORT } from './domain/port/schedule.repository.port';
import { ScheduleDispatcher } from './infrastructure/schedule.dispatcher';
import { SchedulePrismaRepository } from './infrastructure/schedule.prisma.repository';
import { ScheduleConsoleController } from './interface/schedule-console.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ScheduleConsoleController],
  providers: [
    { provide: SCHEDULE_REPOSITORY_PORT, useClass: SchedulePrismaRepository },
    RegisterScheduleUsecase,
    ListSchedulesUsecase,
    UpdateScheduleStatusUsecase,
    DeleteScheduleUsecase,
    ScheduleDispatcher,
    ConsoleReadGuard,
    LoopbackOnlyGuard,
  ],
  exports: [
    RegisterScheduleUsecase,
    ListSchedulesUsecase,
    UpdateScheduleStatusUsecase,
    DeleteScheduleUsecase,
    ScheduleDispatcher,
  ],
})
export class ScheduleModule {}
