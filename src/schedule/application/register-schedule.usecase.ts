import { Inject, Injectable } from '@nestjs/common';

import { plainDateToUtcDate } from '../domain/parse-due-date';
import {
  SaveScheduleInput,
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { PlainDate, ScheduleItemRecord } from '../domain/schedule.type';

export interface RegisterScheduleInput {
  slackUserId: string;
  title: string;
  dueDate: PlainDate;
  memo?: string;
  startDate?: PlainDate | null;
  dueTime?: string;
  remindAt?: Date | null;
  isHoliday?: boolean;
}

const toSaveInput = (input: RegisterScheduleInput): SaveScheduleInput => ({
  slackUserId: input.slackUserId,
  title: input.title,
  dueDate: plainDateToUtcDate(input.dueDate),
  memo: input.memo,
  ...(input.startDate !== undefined && {
    startDate: input.startDate ? plainDateToUtcDate(input.startDate) : null,
  }),
  ...(input.dueTime !== undefined && { dueTime: input.dueTime }),
  ...(input.remindAt !== undefined && { remindAt: input.remindAt }),
  isHoliday: input.isHoliday,
});

@Injectable()
export class RegisterScheduleUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: RegisterScheduleInput): Promise<ScheduleItemRecord> {
    return await this.repository.save(toSaveInput(input));
  }

  async executeMany(
    inputs: RegisterScheduleInput[],
  ): Promise<ScheduleItemRecord[]> {
    return await this.repository.saveMany(inputs.map(toSaveInput));
  }
}
