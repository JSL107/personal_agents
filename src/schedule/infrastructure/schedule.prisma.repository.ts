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
  isHoliday: boolean;
}

interface DueDateFilter {
  gte?: Date;
  lte: Date;
}

// `from` 이 없으면 `gte` 를 **아예 싣지 않는다**. Prisma 가 `undefined` 를 알아서 빼 주기는
// 하지만 그 동작에 기대면 읽는 사람이 "하한 없음" 이 의도인지 실수인지 구분할 수 없고,
// 에폭(`new Date(0)`) 같은 대체 하한을 쓰면 그 숫자의 뜻을 아무도 알 수 없다.
const buildDueDateFilter = (input: FindByDateRangeInput): DueDateFilter => {
  if (input.from === undefined) {
    return { lte: input.to };
  }
  return { gte: input.from, lte: input.to };
};

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
    isHoliday: row.isHoliday,
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
        isHoliday: input.isHoliday ?? false,
      },
    });
    return toRecord(created);
  }

  async findByDateRange(
    input: FindByDateRangeInput,
  ): Promise<ScheduleItemRecord[]> {
    // 마감일 오름차순 — 기한이 지난 것이 먼저 온다. 브리핑 한 줄(`formatUpcomingLine`)도
    // 콘솔 목록도 받은 순서를 그대로 쓰므로 "지난 것이 앞" 은 여기 한 곳이 정한다.
    const rows = await this.prisma.scheduleItem.findMany({
      where: {
        slackUserId: input.slackUserId,
        dueDate: buildDueDateFilter(input),
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
