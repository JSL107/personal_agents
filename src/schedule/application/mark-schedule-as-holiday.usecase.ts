import { Inject, Injectable } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord } from '../domain/schedule.type';

// 이미 있는 일정을 공휴일로 승격한다. 공휴일 동기화 전용이라 상태(`status`)는 건드리지
// 않는다 — 사용자가 이미 완료를 눌러 둔 줄이라면 그 사실이 승격으로 지워지면 안 된다.
@Injectable()
export class MarkScheduleAsHolidayUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(id: number): Promise<ScheduleItemRecord> {
    return await this.repository.markAsHoliday(id);
  }
}
