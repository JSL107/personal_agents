import { Inject, Injectable } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord } from '../domain/schedule.type';

export interface ListSchedulesInput {
  slackUserId: string;
  // 생략하면 하한 없이 조회한다 — 근거는 `FindByDateRangeInput.from` 주석.
  from?: Date;
  to: Date;
}

@Injectable()
export class ListSchedulesUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: ListSchedulesInput): Promise<ScheduleItemRecord[]> {
    return await this.repository.findByDateRange(input);
  }
}
