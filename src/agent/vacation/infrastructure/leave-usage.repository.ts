import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { plainDateToUtcDate, utcDateToPlainDate } from '../domain/plain-date';
import { LeaveUsageRecord, RegisterLeaveInput } from '../domain/vacation.type';

interface SoftCancelInput {
  slackUserId: string;
  usageId: number;
  canceledAt: Date;
}

type LeaveUsageRow = {
  id: number;
  slackUserId: string;
  startDate: Date;
  endDate: Date;
  businessDays: number;
  memo: string | null;
  createdAt: Date;
};

// businessDays 는 호출자(usecase)가 계산해 넘긴다. repo 는 저장/조회만.
interface SaveLeaveInput extends Omit<RegisterLeaveInput, 'memo'> {
  businessDays: number;
  memo?: string;
}

@Injectable()
export class LeaveUsageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveLeaveInput): Promise<LeaveUsageRecord> {
    const row = await this.prisma.leaveUsage.create({
      data: {
        slackUserId: input.slackUserId,
        startDate: plainDateToUtcDate(input.startDate),
        endDate: plainDateToUtcDate(input.endDate),
        businessDays: input.businessDays,
        memo: input.memo ?? null,
      },
    });
    return mapRow(row);
  }

  async findActiveByUser(slackUserId: string): Promise<LeaveUsageRecord[]> {
    const rows = await this.prisma.leaveUsage.findMany({
      where: { slackUserId, canceledAt: null },
      orderBy: { startDate: 'desc' },
    });
    return rows.map(mapRow);
  }

  // 본인 소유 + 아직 미취소 건만 취소. 영향 행이 0 이면 false (없거나 남의 것).
  async softCancel({
    slackUserId,
    usageId,
    canceledAt,
  }: SoftCancelInput): Promise<boolean> {
    const { count } = await this.prisma.leaveUsage.updateMany({
      where: { id: usageId, slackUserId, canceledAt: null },
      data: { canceledAt },
    });
    return count > 0;
  }
}

const mapRow = (row: LeaveUsageRow): LeaveUsageRecord => ({
  id: row.id,
  slackUserId: row.slackUserId,
  startDate: utcDateToPlainDate(row.startDate),
  endDate: utcDateToPlainDate(row.endDate),
  businessDays: row.businessDays,
  memo: row.memo,
  createdAt: row.createdAt,
});
