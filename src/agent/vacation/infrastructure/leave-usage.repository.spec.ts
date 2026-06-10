import { PrismaService } from '../../../prisma/prisma.service';
import { LeaveUsageRepository } from './leave-usage.repository';

describe('LeaveUsageRepository', () => {
  const row = {
    id: 1,
    slackUserId: 'U1',
    startDate: new Date('2026-07-01T00:00:00.000Z'),
    endDate: new Date('2026-07-03T00:00:00.000Z'),
    businessDays: 3,
    memo: null,
    canceledAt: null,
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
  };

  it('save 는 PlainDate 를 UTC Date 로 저장하고 도메인 레코드로 매핑', async () => {
    const create = jest.fn().mockResolvedValue(row);
    const prisma = { leaveUsage: { create } } as unknown as PrismaService;
    const repo = new LeaveUsageRepository(prisma);

    const result = await repo.save({
      slackUserId: 'U1',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      businessDays: 3,
      memo: undefined,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        slackUserId: 'U1',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-07-03T00:00:00.000Z'),
        businessDays: 3,
        memo: null,
      },
    });
    expect(result).toMatchObject({
      id: 1,
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      businessDays: 3,
    });
  });

  it('findActiveByUser 는 canceledAt=null 조건 + 매핑', async () => {
    const findMany = jest.fn().mockResolvedValue([row]);
    const prisma = { leaveUsage: { findMany } } as unknown as PrismaService;
    const repo = new LeaveUsageRepository(prisma);

    const result = await repo.findActiveByUser('U1');

    expect(findMany).toHaveBeenCalledWith({
      where: { slackUserId: 'U1', canceledAt: null },
      orderBy: { startDate: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].startDate).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it('softCancel 은 본인 소유 + 미취소 건만 update (count 0 이면 false)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = { leaveUsage: { updateMany } } as unknown as PrismaService;
    const repo = new LeaveUsageRepository(prisma);

    const ok = await repo.softCancel({
      slackUserId: 'U1',
      usageId: 99,
      canceledAt: new Date('2026-06-10T00:00:00.000Z'),
    });
    expect(ok).toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 99, slackUserId: 'U1', canceledAt: null },
      data: { canceledAt: new Date('2026-06-10T00:00:00.000Z') },
    });
  });
});
