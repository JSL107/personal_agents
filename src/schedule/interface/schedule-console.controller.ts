import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LoopbackOnlyGuard } from '../../common/guard/loopback-only.guard';
import { ConsoleReadGuard } from '../../console/interface/console-read.guard';
import { DeleteScheduleUsecase } from '../application/delete-schedule.usecase';
import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import {
  parseDateParam,
  parsePlainDateParam,
} from '../domain/parse-date-param';
import { ScheduleItemRecord } from '../domain/schedule.type';
import { ScheduleSlackNotifier } from '../infrastructure/schedule-slack.notifier';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

// 입구는 Slack 자연어와 이 POST 둘이다. 한때 Slack 하나로 두었던 것은 "등록이 실제로
// 일어나는가" 를 한 곳에서만 재기 위해서였는데, 정작 달력을 보다가 일정을 떠올린 사람이
// Slack 으로 건너갔다 돌아와야 했다 — 달력 위에서 바로 넣는 편이 등록 자체를 더 일으킨다.
// 두 입구는 같은 `RegisterScheduleUsecase` 를 지나므로 저장 규칙은 여전히 한 벌이고,
// 어느 쪽에서 들어왔는지는 Slack 알림 문구가 갈라 준다(`formatScheduleRegisteredFromConsole`).
@Controller('v1/console')
export class ScheduleConsoleController {
  constructor(
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly registerSchedule: RegisterScheduleUsecase,
    private readonly updateStatus: UpdateScheduleStatusUsecase,
    private readonly deleteSchedule: DeleteScheduleUsecase,
    private readonly slackNotifier: ScheduleSlackNotifier,
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
        'CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않아 일정 기능을 쓸 수 없습니다.',
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

  @Post('schedules')
  @UseGuards(LoopbackOnlyGuard)
  async create(@Body() dto: CreateScheduleDto): Promise<ScheduleItemRecord> {
    // 공백만 친 제목은 `@MaxLength` 를 통과한다. 여기서 끊지 않으면 달력에 빈 칩이 서고,
    // 그 칩은 눌러도 이름이 없어 무엇을 지우는 것인지 알 수 없는 줄이 된다.
    const title = dto.title.trim();
    if (!title) {
      throw new BadRequestException('제목을 입력하세요.');
    }
    const memo = dto.memo?.trim();
    const record = await this.registerSchedule.execute({
      slackUserId: this.requireOwner(),
      title,
      dueDate: parsePlainDateParam(dto.dueDate, 'dueDate'),
      // 공백만 남은 메모는 아예 없는 것으로 둔다 — 빈 문자열을 저장하면 상세 패널이
      // 메모 줄을 그리고 거기에 아무것도 없다.
      memo: memo ? memo : undefined,
    });
    // 발송이 실패해도 등록은 유효하므로 notifier 가 안에서 삼킨다(그 주석 참조).
    // 그래도 `await` 하는 것은 순서를 결정적으로 두기 위해서다 — 버려 두면 응답이 먼저
    // 나가고 알림은 다음 회차에 뜨거나 안 뜨는데, 어느 쪽인지 밖에서 알 수 없다.
    await this.slackNotifier.notifyRegistered(record);
    return record;
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
