import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';

import { LoopbackOnlyGuard } from '../common/guard/loopback-only.guard';
import { ConsoleReadGuard } from '../console/interface/console-read.guard';
import { PrismaModule } from '../prisma/prisma.module';
import { DeleteScheduleUsecase } from './application/delete-schedule.usecase';
import { ListSchedulesUsecase } from './application/list-schedules.usecase';
import { RegisterConsoleScheduleUsecase } from './application/register-console-schedule.usecase';
import { RegisterScheduleUsecase } from './application/register-schedule.usecase';
import { UpdateScheduleStatusUsecase } from './application/update-schedule-status.usecase';
import { SCHEDULE_REPOSITORY_PORT } from './domain/port/schedule.repository.port';
import { SCHEDULE_NOTIFIER_PORT } from './domain/port/schedule-notifier.port';
import { ScheduleDispatcher } from './infrastructure/schedule.dispatcher';
import { SchedulePrismaRepository } from './infrastructure/schedule.prisma.repository';
import {
  SCHEDULE_SLACK_CLIENT_OPTIONS,
  SCHEDULE_SLACK_WEB_CLIENT,
  ScheduleSlackNotifier,
} from './infrastructure/schedule-slack.notifier';
import { ScheduleConsoleController } from './interface/schedule-console.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ScheduleConsoleController],
  providers: [
    { provide: SCHEDULE_REPOSITORY_PORT, useClass: SchedulePrismaRepository },
    RegisterScheduleUsecase,
    RegisterConsoleScheduleUsecase,
    ListSchedulesUsecase,
    UpdateScheduleStatusUsecase,
    DeleteScheduleUsecase,
    ScheduleDispatcher,
    { provide: SCHEDULE_NOTIFIER_PORT, useClass: ScheduleSlackNotifier },
    ConsoleReadGuard,
    LoopbackOnlyGuard,
    // 토큰이 없으면 null 을 주입하고 notifier 가 발송을 건너뛴다 — 여기서 throw 하면
    // Slack 을 붙이지 않은 환경에서 모듈 전체가 뜨지 않아 일정 조회까지 같이 죽는다.
    // `BlogModule` 의 `BLOG_SLACK_WEB_CLIENT` 와 같은 처리다.
    {
      provide: SCHEDULE_SLACK_WEB_CLIENT,
      useFactory: (configService: ConfigService): WebClient | null => {
        const token = configService.get<string>('SLACK_BOT_TOKEN');
        if (!token) {
          return null;
        }
        // 옵션은 notifier 가 소유한다 — 여기에 숫자를 따로 적으면 "왜 3초인가" 가 적힌
        // 곳과 실제로 쓰이는 곳이 갈라지고, 한쪽만 바뀐다.
        return new WebClient(token, SCHEDULE_SLACK_CLIENT_OPTIONS);
      },
      inject: [ConfigService],
    },
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
