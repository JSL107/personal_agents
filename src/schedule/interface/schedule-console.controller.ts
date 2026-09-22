import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LoopbackOnlyGuard } from '../../common/guard/loopback-only.guard';
import { ConsoleReadGuard } from '../../console/interface/console-read.guard';
import { DeleteScheduleUsecase } from '../application/delete-schedule.usecase';
import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import { parseDateParam } from '../domain/parse-date-param';
import { ScheduleItemRecord } from '../domain/schedule.type';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

// 등록(POST)은 두지 않는다 — 입구는 Slack 자연어 하나다. 입구가 둘이면 어느 쪽이 정본인지
// 흐려지고, "등록이 실제로 일어나는가" 라는 승격 조건의 측정도 흐려진다.
@Controller('v1/console')
export class ScheduleConsoleController {
  constructor(
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly updateStatus: UpdateScheduleStatusUsecase,
    private readonly deleteSchedule: DeleteScheduleUsecase,
    private readonly configService: ConfigService,
  ) {}

  // 이 env 는 `app.config.ts` 에서 optional 이라 미설정 상태로 요청이 들어올 수 있다.
  // `getOrThrow` 는 HttpException 이 아닌 TypeError 를 던져 전역 필터가 500 으로 뭉갠다.
  // 콘솔 앱은 이미 503 을 "CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않았습니다" 안내로 매핑하므로
  // (`AppRootView.swift:170`) 503 으로 던져야 사용자가 무엇을 고쳐야 할지 안다.
  // `console-write.service.ts:97` 의 `requireOwner()` 와 같은 처리다.
  private requireOwner(): string {
    const owner = this.configService.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    if (!owner) {
      throw new ServiceUnavailableException(
        'CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않아 일정을 조회할 수 없습니다.',
      );
    }
    return owner;
  }

  @Get('schedules')
  @UseGuards(ConsoleReadGuard)
  async list(
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<ScheduleItemRecord[]> {
    return await this.listSchedules.execute({
      slackUserId: this.requireOwner(),
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
    return await this.updateStatus.execute({
      id,
      status: dto.status,
      slackUserId: this.requireOwner(),
    });
  }

  @Delete('schedules/:id')
  @UseGuards(LoopbackOnlyGuard)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.deleteSchedule.execute({
      id,
      slackUserId: this.requireOwner(),
    });
  }
}
