import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { UpdateScheduleStatusUsecase } from './update-schedule-status.usecase';

const baseRecord: ScheduleItemRecord = {
  ...buildScheduleItemRecord(),
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
  const repository = {
    save: jest.fn(),
    findByDateRange: jest.fn(),
    findById: jest.fn().mockResolvedValue(record),
    transition: jest.fn().mockImplementation((input: unknown) => {
      updates.push(input);
      return Promise.resolve({ ...baseRecord, status: ScheduleStatus.DONE });
    }),
    markAsHoliday: jest.fn(),
    deleteById: jest.fn(),
  } as unknown as ScheduleRepositoryPort;
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
    expect((updates[0] as { now: Date }).now).toBeInstanceOf(Date);
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

    expect(updates[0]).toEqual(
      expect.objectContaining({
        from: ScheduleStatus.DONE,
        to: ScheduleStatus.OPEN,
      }),
    );
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

  it('후보 상태로 되돌리는 전이는 400 으로 거부한다', async () => {
    const { repository } = createRepository({
      ...baseRecord,
      status: ScheduleStatus.IN_PROGRESS,
    });
    await expect(
      new UpdateScheduleStatusUsecase(repository).execute({
        id: 1,
        slackUserId: 'U1',
        status: ScheduleStatus.CANDIDATE,
      }),
    ).rejects.toThrow(BadRequestException);
  });
  it('조건부 전이가 실패하면 409 로 답한다', async () => {
    const { repository } = createRepository(baseRecord);
    repository.transition = jest.fn().mockResolvedValue(null);
    await expect(
      new UpdateScheduleStatusUsecase(repository).execute({
        id: 1,
        slackUserId: 'U1',
        status: ScheduleStatus.DONE,
      }),
    ).rejects.toThrow(ConflictException);
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

describe('상태와 필드 동시 수정의 날짜 경합', () => {
  it('검증 시의 날짜 스냅샷을 전이 저장소에 전달한다', async () => {
    const found = { ...baseRecord, startDate: null, dueTime: '09:00' };
    const repository = {
      findById: jest.fn().mockResolvedValue(found),
      transition: jest.fn().mockResolvedValue(found),
    } as unknown as ScheduleRepositoryPort;
    const expected = {
      dueDate: found.dueDate,
      startDate: null,
      dueTime: '09:00',
    };
    await new UpdateScheduleStatusUsecase(repository).execute({
      id: 1,
      slackUserId: 'U1',
      status: ScheduleStatus.DONE,
      patch: { startDate: new Date('2026-09-29') },
      expected,
    });
    expect(repository.transition).toHaveBeenCalledWith(
      expect.objectContaining({ expected }),
    );
  });
});
