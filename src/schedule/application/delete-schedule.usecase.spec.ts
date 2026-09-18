import { NotFoundException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { DeleteScheduleUsecase } from './delete-schedule.usecase';

const found: ScheduleItemRecord = {
  id: 1,
  slackUserId: 'U1',
  title: '자동차세',
  dueDate: new Date('2026-09-30T00:00:00.000Z'),
  dueTime: null,
  linkUrl: null,
  memo: null,
  status: ScheduleStatus.OPEN,
  completedAt: null,
};

const createRepository = (
  record: ScheduleItemRecord | null,
): ScheduleRepositoryPort => ({
  save: jest.fn(),
  findByDateRange: jest.fn(),
  findById: jest.fn().mockResolvedValue(record),
  updateStatus: jest.fn(),
  deleteById: jest.fn().mockResolvedValue(undefined),
});

describe('DeleteScheduleUsecase', () => {
  it('있는 항목이면 지운다', async () => {
    const repository = createRepository(found);
    await new DeleteScheduleUsecase(repository).execute({ id: 1 });
    expect(repository.deleteById).toHaveBeenCalledWith(1);
  });

  it('없는 항목이면 404 로 끊는다 — Prisma 예외가 500 으로 새는 것을 막는다', async () => {
    const repository = createRepository(null);
    await expect(
      new DeleteScheduleUsecase(repository).execute({ id: 99 }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });
});
