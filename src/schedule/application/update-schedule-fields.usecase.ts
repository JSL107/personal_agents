import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { computeAutoRemindAt } from '../domain/auto-remind-at';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import {
  PreparedScheduleFields,
  UpdateScheduleFieldsInput,
} from '../domain/schedule.repository.type';
import { ScheduleItemRecord } from '../domain/schedule.type';

@Injectable()
export class UpdateScheduleFieldsUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: UpdateScheduleFieldsInput): Promise<ScheduleItemRecord> {
    const prepared = await this.prepare(input);
    const updated = await this.repository.updateFields({
      ...input,
      ...prepared,
    });
    if (!updated) {
      throw new ConflictException(
        '일정 날짜가 변경되었습니다. 다시 시도해 주세요.',
      );
    }
    return updated;
  }

  async prepare(
    input: UpdateScheduleFieldsInput,
  ): Promise<PreparedScheduleFields> {
    const found = await this.repository.findById(input.id);
    if (!found || found.slackUserId !== input.slackUserId) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    const dueDate = input.patch.dueDate ?? found.dueDate;
    const startDate =
      input.patch.startDate === undefined
        ? found.startDate
        : input.patch.startDate;
    if (startDate && dueDate && startDate > dueDate) {
      throw new BadRequestException('시작일은 마감일보다 늦을 수 없습니다.');
    }
    const patch = { ...input.patch };
    if (!found.dueTime && patch.dueTime && patch.remindAt === undefined) {
      patch.remindAt = computeAutoRemindAt({
        dueDate,
        dueTime: patch.dueTime,
        now: new Date(),
      });
    }
    return {
      patch,
      expected: {
        dueDate: found.dueDate,
        startDate: found.startDate ?? null,
        dueTime: found.dueTime,
      },
    };
  }
}
