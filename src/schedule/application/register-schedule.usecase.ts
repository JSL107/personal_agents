import { Inject, Injectable } from '@nestjs/common';

import { plainDateToUtcDate } from '../domain/parse-due-date';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { PlainDate, ScheduleItemRecord } from '../domain/schedule.type';

export interface RegisterScheduleInput {
  slackUserId: string;
  title: string;
  dueDate: PlainDate;
  memo?: string;
}

@Injectable()
export class RegisterScheduleUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: RegisterScheduleInput): Promise<ScheduleItemRecord> {
    return await this.repository.save({
      slackUserId: input.slackUserId,
      title: input.title,
      dueDate: plainDateToUtcDate(input.dueDate),
      memo: input.memo,
    });
  }
}
