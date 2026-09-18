import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import {
  canTransition,
  ScheduleItemRecord,
  ScheduleStatus,
} from '../domain/schedule.type';

export interface UpdateScheduleStatusInput {
  id: number;
  status: ScheduleStatus;
}

@Injectable()
export class UpdateScheduleStatusUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: UpdateScheduleStatusInput): Promise<ScheduleItemRecord> {
    const found = await this.repository.findById(input.id);
    if (!found) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    if (!canTransition(found.status, input.status)) {
      throw new NotFoundException('이미 같은 상태입니다.');
    }
    return await this.repository.updateStatus({
      id: input.id,
      status: input.status,
      completedAt: input.status === ScheduleStatus.DONE ? new Date() : null,
    });
  }
}
