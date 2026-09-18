import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LoopbackOnlyGuard } from '../../common/guard/loopback-only.guard';
import { ConsoleReadGuard } from '../../console/interface/console-read.guard';
import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import { parseDateParam } from '../domain/parse-date-param';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord } from '../domain/schedule.type';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

// 등록(POST)은 두지 않는다 — 입구는 Slack 자연어 하나다. 입구가 둘이면 어느 쪽이 정본인지
// 흐려지고, "등록이 실제로 일어나는가" 라는 승격 조건의 측정도 흐려진다.
@Controller('v1/console')
export class ScheduleConsoleController {
  constructor(
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly updateStatus: UpdateScheduleStatusUsecase,
    private readonly configService: ConfigService,
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  @Get('schedules')
  @UseGuards(ConsoleReadGuard)
  async list(
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<ScheduleItemRecord[]> {
    const ownerSlackUserId = this.configService.getOrThrow<string>(
      'CONSOLE_OWNER_SLACK_USER_ID',
    );
    return await this.listSchedules.execute({
      slackUserId: ownerSlackUserId,
      from: parseDateParam(from, 'from'),
      to: parseDateParam(to, 'to'),
    });
  }

  @Patch('schedules/:id')
  @UseGuards(LoopbackOnlyGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScheduleDto,
  ): Promise<ScheduleItemRecord> {
    return await this.updateStatus.execute({ id, status: dto.status });
  }

  @Delete('schedules/:id')
  @UseGuards(LoopbackOnlyGuard)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    // 리포지토리를 직접 쓰지 않고 usecase 를 거치는 편이 낫지만, 삭제는 규칙이 없어
    // usecase 를 하나 더 만들 이유가 없다. 규칙이 생기면 그때 승격한다.
    await this.repository.deleteById(id);
  }
}
