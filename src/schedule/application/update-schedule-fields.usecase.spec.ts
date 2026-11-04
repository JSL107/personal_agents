import { BadRequestException, ConflictException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleStatus } from '../domain/schedule.type';
import { UpdateScheduleFieldsUsecase } from './update-schedule-fields.usecase';

describe('UpdateScheduleFieldsUsecase', () => {
  const found = {
    id: 1,
    slackUserId: 'U1',
    title: '업무',
    dueDate: new Date('2026-11-05'),
    dueTime: '09:00',
    startDate: null,
    remindAt: null,
    linkUrl: null,
    memo: null,
    status: ScheduleStatus.OPEN,
    completedAt: null,
    isHoliday: false,
  };
  it('기존 마감 시각을 바꿀 때 끈 알림을 다시 만들지 않는다', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue(found),
      updateFields: jest.fn().mockResolvedValue(found),
    } as unknown as ScheduleRepositoryPort;
    await new UpdateScheduleFieldsUsecase(repository).execute({
      id: 1,
      slackUserId: 'U1',
      patch: { dueTime: '10:00' },
    });
    expect(repository.updateFields).toHaveBeenCalledWith({
      id: 1,
      slackUserId: 'U1',
      patch: { dueTime: '10:00' },
      expected: { dueDate: found.dueDate, startDate: null, dueTime: '09:00' },
    });
  });
  it('자동 알림 시각이 이미 지났으면 기존 수동 알림 시각을 유지한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-05T06:00:00Z'));
    try {
      const manualRemindAt = new Date('2026-11-06T02:00:00Z');
      const record = { ...found, dueTime: null, remindAt: manualRemindAt };
      const repository = {
        findById: jest.fn().mockResolvedValue(record),
        updateFields: jest.fn().mockResolvedValue(record),
      } as unknown as ScheduleRepositoryPort;
      await new UpdateScheduleFieldsUsecase(repository).execute({
        id: 1,
        slackUserId: 'U1',
        patch: { dueTime: '15:00' },
      });
      expect(repository.updateFields).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { dueTime: '15:00' } }),
      );
    } finally {
      jest.useRealTimers();
    }
  });
  it('시작일이 마감일보다 늦으면 거부한다', async () => {
    const repository = {
      findById: jest.fn().mockResolvedValue(found),
      updateFields: jest.fn(),
    } as unknown as ScheduleRepositoryPort;
    await expect(
      new UpdateScheduleFieldsUsecase(repository).execute({
        id: 1,
        slackUserId: 'U1',
        patch: { startDate: new Date('2026-11-06') },
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('날짜 스냅샷 조건부 필드 수정', () => {
  it('검증 시 읽은 dueDate/startDate/dueTime 스냅샷을 저장소에 넘긴다', async () => {
    const found = {
      id: 1,
      slackUserId: 'U1',
      dueDate: new Date('2026-11-05'),
      startDate: null,
      dueTime: '09:00',
    };
    const repository = {
      findById: jest.fn().mockResolvedValue(found),
      updateFields: jest.fn().mockResolvedValue(found),
    } as unknown as ScheduleRepositoryPort;
    await new UpdateScheduleFieldsUsecase(repository).execute({
      id: 1,
      slackUserId: 'U1',
      patch: { startDate: new Date('2026-11-04') },
    });
    expect(repository.updateFields).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: { dueDate: found.dueDate, startDate: null, dueTime: '09:00' },
      }),
    );
  });

  it('날짜 스냅샷이 바뀌어 갱신 0건이면 409를 준다', async () => {
    const found = {
      id: 1,
      slackUserId: 'U1',
      dueDate: new Date('2026-11-05'),
      startDate: null,
      dueTime: '09:00',
    };
    const repository = {
      findById: jest.fn().mockResolvedValue(found),
      updateFields: jest.fn().mockResolvedValue(null),
    } as unknown as ScheduleRepositoryPort;
    await expect(
      new UpdateScheduleFieldsUsecase(repository).execute({
        id: 1,
        slackUserId: 'U1',
        patch: { startDate: new Date('2026-11-04') },
      }),
    ).rejects.toThrow(ConflictException);
  });
});
