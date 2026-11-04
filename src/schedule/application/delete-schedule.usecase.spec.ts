import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import {
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
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
  isHoliday: false,
};

const createRepository = (
  record: ScheduleItemRecord | null,
): ScheduleRepositoryPort =>
  ({
    save: jest.fn(),
    findByDateRange: jest.fn(),
    findById: jest.fn().mockResolvedValue(record),
    updateStatus: jest.fn(),
    markAsHoliday: jest.fn(),
    deleteById: jest.fn().mockResolvedValue(undefined),
  }) as unknown as ScheduleRepositoryPort;

describe('DeleteScheduleUsecase', () => {
  it('있는 항목이면 지운다', async () => {
    const repository = createRepository(found);
    await new DeleteScheduleUsecase(repository).execute({
      id: 1,
      slackUserId: 'U1',
    });
    expect(repository.deleteById).toHaveBeenCalledWith(1);
  });

  // 공휴일 행은 영업일 달력의 정본이다. 지우면 다음 주간 동기화까지 그 날이 거래일로 계산된다.
  it('수집 업무 삭제는 삭제 대신 SKIPPED 전이로 남긴다', async () => {
    const repository = createRepository({
      ...found,
      source: ScheduleSource.SLACK_MENTION,
    });
    repository.transition = jest
      .fn()
      .mockResolvedValue({ ...found, status: ScheduleStatus.SKIPPED });
    await new DeleteScheduleUsecase(repository).execute({
      id: 1,
      slackUserId: 'U1',
    });
    expect(repository.deleteById).not.toHaveBeenCalled();
    expect(repository.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        from: ScheduleStatus.OPEN,
        to: ScheduleStatus.SKIPPED,
      }),
    );
  });

  it('공휴일 행은 지우지 않는다', async () => {
    const repository = createRepository({
      ...found,
      title: '추석',
      isHoliday: true,
    });
    await expect(
      new DeleteScheduleUsecase(repository).execute({
        id: 1,
        slackUserId: 'U1',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });

  it('없는 항목이면 404 로 끊는다 — Prisma 예외가 500 으로 새는 것을 막는다', async () => {
    const repository = createRepository(null);
    await expect(
      new DeleteScheduleUsecase(repository).execute({
        id: 99,
        slackUserId: 'U1',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });

  it('남의 일정이면 지우지 않고 404 로 답한다 — 403 으로 구분해 주면 그 id 의 존재가 샌다', async () => {
    const repository = createRepository(found);
    await expect(
      new DeleteScheduleUsecase(repository).execute({
        id: 1,
        slackUserId: 'U-OTHER',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.deleteById).not.toHaveBeenCalled();
  });
});
