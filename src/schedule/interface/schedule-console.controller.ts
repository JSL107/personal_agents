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
import { RegisterConsoleScheduleUsecase } from '../application/register-console-schedule.usecase';
import { ScheduleFollowUpUsecase } from '../application/schedule-follow-up.usecase';
import { UpdateScheduleFieldsUsecase } from '../application/update-schedule-fields.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import { plainDateToUtcDate } from '../domain/parse-due-date';
import {
  ScheduleEventRecord,
  ScheduleFieldsPatch,
  ScheduleFollowUpRecord,
} from '../domain/schedule.repository.type';
import {
  FollowUpTrigger,
  ScheduleEventKind,
  ScheduleItemRecord,
} from '../domain/schedule.type';
import { CreateFollowUpDto } from './dto/create-follow-up.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateFollowUpDto } from './dto/update-follow-up.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import {
  projectForLegacy,
  projectItemForLegacy,
} from './legacy-schedule.projection';
import { parseDateParam, parsePlainDateParam } from './parse-date-param';
import { ScheduleConsoleDetail } from './schedule-console.type';

// 입구는 Slack 자연어와 이 POST 둘이다. 한때 Slack 하나로 두었던 것은 "등록이 실제로
// 일어나는가" 를 한 곳에서만 재기 위해서였는데, 정작 달력을 보다가 일정을 떠올린 사람이
// Slack 으로 건너갔다 돌아와야 했다 — 달력 위에서 바로 넣는 편이 등록 자체를 더 일으킨다.
// 두 입구는 같은 `RegisterScheduleUsecase` 를 지나므로 저장 규칙은 여전히 한 벌이고,
// 어느 쪽에서 들어왔는지는 Slack 알림 문구가 갈라 준다(`formatScheduleRegisteredFromConsole`).
@Controller('v1/console')
export class ScheduleConsoleController {
  constructor(
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly registerSchedule: RegisterConsoleScheduleUsecase,
    private readonly updateStatus: UpdateScheduleStatusUsecase,
    private readonly deleteSchedule: DeleteScheduleUsecase,
    private readonly configService: ConfigService,
    private readonly updateFields: UpdateScheduleFieldsUsecase,
    private readonly followUp: ScheduleFollowUpUsecase,
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
    @Query('view') view?: string,
  ): Promise<ScheduleItemRecord[]> {
    const query = {
      slackUserId: this.requireOwner(),
      from: parseDateParam(from, 'from'),
      to: parseDateParam(to, 'to'),
    };
    const items =
      view === 'tracking'
        ? await this.listSchedules.tracking(query)
        : await this.listSchedules.execute(query);
    const visible = view === 'tracking' ? items : projectForLegacy(items);
    return await this.followUp.withPendingCounts(visible);
  }

  @Get('schedules/undated')
  @UseGuards(ConsoleReadGuard)
  async undated(): Promise<ScheduleItemRecord[]> {
    const items = await this.listSchedules.undated(this.requireOwner());
    return await this.followUp.withPendingCounts(items);
  }

  @Get('schedules/:id')
  @UseGuards(ConsoleReadGuard)
  async detail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ScheduleConsoleDetail> {
    const found = await this.followUp.detail({
      id,
      slackUserId: this.requireOwner(),
    });
    return {
      ...found,
      linkedPullRequests: found.events.filter(
        (event) => event.kind === ScheduleEventKind.PR_LINKED,
      ),
    };
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
    // 저장과 알림의 조율은 `RegisterConsoleScheduleUsecase` 가 한다 — 컨트롤러는 HTTP
    // 입력을 usecase 입력으로 옮기는 데까지만 관여한다(`CODE_RULES.md` §7, 의존 방향).
    return await this.registerSchedule.execute({
      slackUserId: this.requireOwner(),
      title,
      dueDate: parsePlainDateParam(dto.dueDate, 'dueDate'),
      startDate: dto.startDate
        ? parsePlainDateParam(dto.startDate, 'startDate')
        : undefined,
      dueTime: dto.dueTime,
      remindAt:
        dto.remindAt === null
          ? null
          : dto.remindAt
            ? parseOffsetDate(dto.remindAt)
            : undefined,
      // 공백만 남은 메모는 아예 없는 것으로 둔다 — 빈 문자열을 저장하면 상세 패널이
      // 메모 줄을 그리고 거기에 아무것도 없다.
      memo: memo ? memo : undefined,
    });
  }

  @Patch('schedules/:id')
  @UseGuards(LoopbackOnlyGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScheduleDto,
    @Query('view') view?: string,
  ): Promise<ScheduleItemRecord> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('수정할 내용을 입력하세요.');
    }
    const slackUserId = this.requireOwner();
    const patch: ScheduleFieldsPatch = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BadRequestException('제목을 입력하세요.');
      }
      patch.title = title;
    }
    if (dto.dueDate !== undefined) {
      patch.dueDate = plainDateToUtcDate(
        parsePlainDateParam(dto.dueDate, 'dueDate'),
      );
    }
    if (dto.startDate !== undefined) {
      patch.startDate =
        dto.startDate === null
          ? null
          : plainDateToUtcDate(parsePlainDateParam(dto.startDate, 'startDate'));
    }
    if (dto.dueTime !== undefined) {
      patch.dueTime = dto.dueTime;
    }
    if (dto.remindAt !== undefined) {
      patch.remindAt =
        dto.remindAt === null ? null : parseOffsetDate(dto.remindAt);
    }
    const hasFields = Object.keys(patch).length > 0;
    const preparedPatch =
      dto.status && hasFields
        ? await this.updateFields.prepare({ id, slackUserId, patch })
        : undefined;
    const item = dto.status
      ? await this.updateStatus.execute({
          id,
          status: dto.status,
          slackUserId,
          ...(preparedPatch && {
            patch: preparedPatch.patch,
            expected: preparedPatch.expected,
          }),
        })
      : hasFields
        ? await this.updateFields.execute({ id, slackUserId, patch })
        : null;
    if (!item) {
      throw new BadRequestException('수정할 내용을 입력하세요.');
    }
    return view === 'tracking' ? item : projectItemForLegacy(item);
  }

  @Post('schedules/:id/follow-ups')
  @UseGuards(LoopbackOnlyGuard)
  async addFollowUp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFollowUpDto,
  ): Promise<ScheduleFollowUpRecord> {
    const recipient = dto.recipient.trim();
    const topic = dto.topic.trim();
    if (!recipient || !topic) {
      throw new BadRequestException('받는 사람과 알릴 내용을 입력하세요.');
    }
    if (dto.trigger === FollowUpTrigger.AT_TIME && !dto.triggerAt) {
      throw new BadRequestException('알릴 시각을 입력하세요.');
    }
    return await this.followUp.add({
      scheduleItemId: id,
      slackUserId: this.requireOwner(),
      recipient,
      topic,
      trigger: dto.trigger,
      triggerAt: dto.triggerAt ? parseOffsetDate(dto.triggerAt) : null,
    });
  }

  @Patch('follow-ups/:id')
  @UseGuards(LoopbackOnlyGuard)
  async updateFollowUp(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFollowUpDto,
  ): Promise<ScheduleFollowUpRecord> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('수정할 내용을 입력하세요.');
    }
    if (
      (dto.recipient !== undefined && !dto.recipient.trim()) ||
      (dto.topic !== undefined && !dto.topic.trim())
    ) {
      throw new BadRequestException('받는 사람과 알릴 내용을 입력하세요.');
    }
    return await this.followUp.update({
      id,
      slackUserId: this.requireOwner(),
      recipient: dto.recipient?.trim(),
      topic: dto.topic?.trim(),
      triggerAt: dto.triggerAt ? parseOffsetDate(dto.triggerAt) : undefined,
      sentAt: dto.sentAt ? parseOffsetDate(dto.sentAt) : undefined,
    });
  }

  @Post('schedules/:id/notes')
  @UseGuards(LoopbackOnlyGuard)
  async addNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteDto,
  ): Promise<ScheduleEventRecord> {
    const text = dto.text.trim();
    if (!text) {
      throw new BadRequestException('메모를 입력하세요.');
    }
    return await this.followUp.note({
      scheduleItemId: id,
      slackUserId: this.requireOwner(),
      text,
      now: new Date(),
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

const parseOffsetDate = (value: string): Date => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException('유효한 알림 시각을 입력하세요.');
  }
  return parsed;
};
