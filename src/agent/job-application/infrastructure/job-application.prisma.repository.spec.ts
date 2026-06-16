import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { JobApplicationPrismaRepository } from './job-application.prisma.repository';

const baseRow = {
  id: 1,
  slackUserId: 'U1',
  company: '토스',
  role: '백엔드',
  jdUrl: null,
  status: 'APPLIED',
  appliedAt: new Date(Date.UTC(2026, 5, 16)),
  deadline: null,
  nextFollowUpAt: null,
  notes: null,
  createdAt: new Date('2026-06-16T00:00:00.000Z'),
};

describe('JobApplicationPrismaRepository', () => {
  it('save 는 plainDate 를 UTC Date 로 저장하고 record 반환', async () => {
    const create = jest.fn().mockResolvedValue(baseRow);
    const prisma = { jobApplication: { create } } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    const record = await repository.save({
      slackUserId: 'U1',
      company: '토스',
      role: '백엔드',
      status: 'APPLIED',
      appliedAt: { year: 2026, month: 6, day: 16 },
    });

    expect(record.company).toBe('토스');
    expect(record.appliedAt).toEqual({ year: 2026, month: 6, day: 16 });
    expect(create.mock.calls[0][0].data.slackUserId).toBe('U1');
    expect(create.mock.calls[0][0].data.appliedAt).toEqual(
      new Date(Date.UTC(2026, 5, 16)),
    );
    expect(create.mock.calls[0][0].data.jdUrl).toBeNull();
    expect(create.mock.calls[0][0].data.deadline).toBeNull();
    expect(create.mock.calls[0][0].data.nextFollowUpAt).toBeNull();
  });

  it('save 는 nextFollowUpAt 이 있으면 UTC Date 로 매핑', async () => {
    const create = jest.fn().mockResolvedValue({
      ...baseRow,
      nextFollowUpAt: new Date(Date.UTC(2026, 5, 23)),
    });
    const prisma = { jobApplication: { create } } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    const record = await repository.save({
      slackUserId: 'U1',
      company: '토스',
      role: '백엔드',
      status: 'APPLIED',
      appliedAt: { year: 2026, month: 6, day: 16 },
      nextFollowUpAt: { year: 2026, month: 6, day: 23 },
    });

    expect(create.mock.calls[0][0].data.nextFollowUpAt).toEqual(
      new Date(Date.UTC(2026, 5, 23)),
    );
    expect(record.nextFollowUpAt).toEqual({ year: 2026, month: 6, day: 23 });
  });

  it('save 는 deadline/jdUrl 이 있으면 그대로 매핑', async () => {
    const create = jest.fn().mockResolvedValue({
      ...baseRow,
      jdUrl: 'https://jd',
      deadline: new Date(Date.UTC(2026, 5, 30)),
    });
    const prisma = { jobApplication: { create } } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    const record = await repository.save({
      slackUserId: 'U1',
      company: '토스',
      role: '백엔드',
      status: 'APPLIED',
      appliedAt: { year: 2026, month: 6, day: 16 },
      jdUrl: 'https://jd',
      deadline: { year: 2026, month: 6, day: 30 },
    });

    expect(create.mock.calls[0][0].data.jdUrl).toBe('https://jd');
    expect(create.mock.calls[0][0].data.deadline).toEqual(
      new Date(Date.UTC(2026, 5, 30)),
    );
    expect(record.deadline).toEqual({ year: 2026, month: 6, day: 30 });
  });

  it('updateStatusByCompany — 없으면 null', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      jobApplication: { findFirst },
    } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    expect(
      await repository.updateStatusByCompany({
        slackUserId: 'U1',
        companyRef: 'X',
        status: 'SCREENING',
        nextFollowUpAt: null,
      }),
    ).toBeNull();
    expect(findFirst.mock.calls[0][0].where.status.notIn).toContain('OFFER');
    expect(findFirst.mock.calls[0][0].where.company.mode).toBe(
      Prisma.QueryMode.insensitive,
    );
  });

  it('updateStatusByCompany — 매칭되면 update 후 record 반환', async () => {
    const findFirst = jest.fn().mockResolvedValue({ ...baseRow, id: 42 });
    const update = jest
      .fn()
      .mockResolvedValue({ ...baseRow, id: 42, status: 'SCREENING' });
    const prisma = {
      jobApplication: { findFirst, update },
    } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    const record = await repository.updateStatusByCompany({
      slackUserId: 'U1',
      companyRef: '토스',
      status: 'SCREENING',
      nextFollowUpAt: { year: 2026, month: 6, day: 23 },
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: {
        status: 'SCREENING',
        nextFollowUpAt: new Date(Date.UTC(2026, 5, 23)),
      },
    });
    expect(record?.status).toBe('SCREENING');
  });

  it('updateStatusByCompany — nextFollowUpAt=null 이면 null 저장', async () => {
    const findFirst = jest.fn().mockResolvedValue({ ...baseRow, id: 42 });
    const update = jest
      .fn()
      .mockResolvedValue({ ...baseRow, id: 42, status: 'OFFER' });
    const prisma = {
      jobApplication: { findFirst, update },
    } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    await repository.updateStatusByCompany({
      slackUserId: 'U1',
      companyRef: '토스',
      status: 'OFFER',
      nextFollowUpAt: null,
    });

    expect(update.mock.calls[0][0].data.nextFollowUpAt).toBeNull();
  });

  it('listByUser — 사용자 레코드 매핑 반환', async () => {
    const findMany = jest.fn().mockResolvedValue([baseRow]);
    const prisma = { jobApplication: { findMany } } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    const records = await repository.listByUser('U1');

    expect(findMany.mock.calls[0][0].where).toEqual({ slackUserId: 'U1' });
    expect(records).toHaveLength(1);
    expect(records[0].company).toBe('토스');
  });

  it('findDueNudges — 마감 ≤horizon(overdue 포함) + 팔로업 OR + 비종료 where', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { jobApplication: { findMany } } as unknown as PrismaService;
    const repository = new JobApplicationPrismaRepository(prisma);

    await repository.findDueNudges({
      slackUserId: 'U1',
      today: { year: 2026, month: 6, day: 16 },
      deadlineWithinDays: 3,
    });

    const where = findMany.mock.calls[0][0].where;
    expect(where.status.notIn).toContain('REJECTED');
    // overdue 마감도 잡히도록 하한(gte)을 두지 않는다.
    expect(where.OR[0].deadline.gte).toBeUndefined();
    expect(where.OR[0].deadline.lte).toEqual(new Date(Date.UTC(2026, 5, 19)));
    expect(where.OR[1].nextFollowUpAt.lte).toEqual(
      new Date(Date.UTC(2026, 5, 16)),
    );
  });
});
