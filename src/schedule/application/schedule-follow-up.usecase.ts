import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import {
  AddFollowUpInput,
  AddNoteInput,
  FindScheduleDetailInput,
  ScheduleDetail,
  ScheduleEventRecord,
  ScheduleFollowUpRecord,
  UpdateFollowUpInput,
} from '../domain/schedule.repository.type';
import { ScheduleItemRecord } from '../domain/schedule.type';

@Injectable()
export class ScheduleFollowUpUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async detail(input: FindScheduleDetailInput): Promise<ScheduleDetail> {
    const found = await this.repository.findDetail(input);
    if (!found) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    return found;
  }

  async withPendingCounts(
    items: ScheduleItemRecord[],
  ): Promise<ScheduleItemRecord[]> {
    if (items.length === 0) {
      return [];
    }
    const counts = await this.repository.countPendingFollowUps({
      scheduleItemIds: items.map((item) => item.id),
    });
    return items.map((item) => ({
      ...item,
      pendingFollowUpCount: counts.get(item.id) ?? 0,
    }));
  }

  async add(input: AddFollowUpInput): Promise<ScheduleFollowUpRecord> {
    const created = await this.repository.addFollowUp(input);
    if (!created) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    return created;
  }

  async update(input: UpdateFollowUpInput): Promise<ScheduleFollowUpRecord> {
    const updated = await this.repository.updateFollowUp(input);
    if (!updated) {
      throw new NotFoundException('해당 연락할 일을 찾을 수 없습니다.');
    }
    return updated;
  }

  async note(input: AddNoteInput): Promise<ScheduleEventRecord> {
    const created = await this.repository.addNote(input);
    if (!created) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    return created;
  }
}
