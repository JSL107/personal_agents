import { ConflictException, NotFoundException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { UpdateScheduleStatusUsecase } from './update-schedule-status.usecase';

const baseRecord: ScheduleItemRecord = {
  id: 1,
  slackUserId: 'U1',
  title: '자동차세',
  dueDate: new Date('2026-09-30T00:00:00.000Z'),
  dueTime: null,
  linkUrl: null,
  memo: null,
  status: ScheduleStatus.OPEN,
  completedAt: null,
  isHoliday: false,
};

const createRepository = (
  record: ScheduleItemRecord | null,
): { repository: ScheduleRepositoryPort; updates: unknown[] } => {
  const updates: unknown[] = [];
  const repository: ScheduleRepositoryPort = {
    save: jest.fn(),
    findByDateRange: jest.fn(),
    findById: jest.fn().mockResolvedValue(record),
    updateStatus: jest.fn().mockImplementation((input: unknown) => {
      updates.push(input);
      return Promise.resolve({ ...baseRecord, status: ScheduleStatus.DONE });
    }),
    markAsHoliday: jest.fn(),
    deleteById: jest.fn(),
  };
  return { repository, updates };
};

describe('UpdateScheduleStatusUsecase', () => {
  it('DONE 으로 바꾸면 completedAt 을 채운다', async () => {
    const { repository, updates } = createRepository(baseRecord);
    const usecase = new UpdateScheduleStatusUsecase(repository);

    await usecase.execute({
      id: 1,
      status: ScheduleStatus.DONE,
      slackUserId: 'U1',
    });

    expect(updates).toHaveLength(1);
    expect(
      (updates[0] as { completedAt: Date | null }).completedAt,
    ).toBeInstanceOf(Date);
  });

  it('OPEN 으로 되돌리면 completedAt 을 비운다', async () => {
    const { repository, updates } = createRepository({
      ...baseRecord,
      status: ScheduleStatus.DONE,
      completedAt: new Date(),
    });
    const usecase = new UpdateScheduleStatusUsecase(repository);

    await usecase.execute({
      id: 1,
      status: ScheduleStatus.OPEN,
      slackUserId: 'U1',
    });

    expect((updates[0] as { completedAt: Date | null }).completedAt).toBeNull();
  });

  it('같은 상태로의 전이는 저장하지 않는다', async () => {
    const { repository, updates } = createRepository(baseRecord);
    const usecase = new UpdateScheduleStatusUsecase(repository);

    await expect(
      usecase.execute({
        id: 1,
        status: ScheduleStatus.OPEN,
        slackUserId: 'U1',
      }),
    ).rejects.toThrow(ConflictException);
    expect(updates).toHaveLength(0);
  });

  it('없는 항목이면 던진다', async () => {
    const { repository } = createRepository(null);
    const usecase = new UpdateScheduleStatusUsecase(repository);

    await expect(
      usecase.execute({
        id: 99,
        status: ScheduleStatus.DONE,
        slackUserId: 'U1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('남의 일정이면 바꾸지 않고 404 로 답한다 — 403 으로 구분해 주면 그 id 의 존재가 샌다', async () => {
    const { repository, updates } = createRepository(baseRecord);
    const usecase = new UpdateScheduleStatusUsecase(repository);

    await expect(
      usecase.execute({
        id: 1,
        status: ScheduleStatus.DONE,
        slackUserId: 'U-OTHER',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(updates).toHaveLength(0);
  });
});
