import { Inject, Injectable } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { CountActiveCandidatesInput } from '../domain/schedule.repository.type';
import {
  DatedScheduleItemRecord,
  ScheduleItemRecord,
} from '../domain/schedule.type';

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

  async execute(input: ListSchedulesInput): Promise<DatedScheduleItemRecord[]> {
    return await this.repository.findByDateRange(input);
  }

  async tracking(
    input: Required<ListSchedulesInput>,
  ): Promise<ScheduleItemRecord[]> {
    return await this.repository.findTrackingMonth(input);
  }

  async countActiveCandidates(
    input: CountActiveCandidatesInput,
  ): Promise<number> {
    return this.repository.countActiveCandidates(input);
  }

  async undated(slackUserId: string): Promise<ScheduleItemRecord[]> {
    return await this.repository.findUndated(slackUserId);
  }
}
