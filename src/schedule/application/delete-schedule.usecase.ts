import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';

export interface DeleteScheduleInput {
  id: number;
}

@Injectable()
export class DeleteScheduleUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: DeleteScheduleInput): Promise<void> {
    const found = await this.repository.findById(input.id);
    if (!found) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    await this.repository.deleteById(input.id);
  }
}
