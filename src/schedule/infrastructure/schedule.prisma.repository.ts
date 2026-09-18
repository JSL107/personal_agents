import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  FindByDateRangeInput,
  SaveScheduleInput,
  ScheduleRepositoryPort,
  UpdateStatusInput,
} from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';

interface ScheduleItemRow {
  id: number;
  slackUserId: string;
  title: string;
  dueDate: Date;
  dueTime: string | null;
  linkUrl: string | null;
  memo: string | null;
  status: string;
  completedAt: Date | null;
}

const toRecord = (row: ScheduleItemRow): ScheduleItemRecord => {
  return {
    id: row.id,
    slackUserId: row.slackUserId,
    title: row.title,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    linkUrl: row.linkUrl,
    memo: row.memo,
    status: row.status as ScheduleStatus,
    completedAt: row.completedAt,
  };
};

@Injectable()
export class SchedulePrismaRepository implements ScheduleRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveScheduleInput): Promise<ScheduleItemRecord> {
    const created = await this.prisma.scheduleItem.create({
      data: {
        slackUserId: input.slackUserId,
        title: input.title,
        dueDate: input.dueDate,
        dueTime: input.dueTime ?? null,
        memo: input.memo ?? null,
        status: ScheduleStatus.OPEN,
      },
    });
    return toRecord(created);
  }

  async findByDateRange(
    input: FindByDateRangeInput,
  ): Promise<ScheduleItemRecord[]> {
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.slackUserId,
        dueDate: { gte: input.from, lte: input.to },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async findById(id: number): Promise<ScheduleItemRecord | null> {
    const found = await this.prisma.scheduleItem.findUnique({ where: { id } });
    if (!found) {
      return null;
    }
    return toRecord(found);
  }

  async updateStatus(input: UpdateStatusInput): Promise<ScheduleItemRecord> {
    const updated = await this.prisma.scheduleItem.update({
      where: { id: input.id },
      data: { status: input.status, completedAt: input.completedAt },
    });
    return toRecord(updated);
  }

  async deleteById(id: number): Promise<void> {
    await this.prisma.scheduleItem.delete({ where: { id } });
  }
}
