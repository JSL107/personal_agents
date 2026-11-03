import { NotFoundException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleFollowUpUsecase } from './schedule-follow-up.usecase';

describe('ScheduleFollowUpUsecase', () => {
  it('여러 업무의 미발송 개수를 한 번에 조회한다', async () => {
    const countPendingFollowUps = jest
      .fn()
      .mockResolvedValue(new Map([[1, 2]]));
    const repository = {
      countPendingFollowUps,
    } as unknown as ScheduleRepositoryPort;
    const items = [
      { id: 1, slackUserId: 'U1' },
      { id: 2, slackUserId: 'U1' },
    ] as never;
    const result = await new ScheduleFollowUpUsecase(
      repository,
    ).withPendingCounts(items);
    expect(countPendingFollowUps).toHaveBeenCalledTimes(1);
    expect(countPendingFollowUps).toHaveBeenCalledWith({
      scheduleItemIds: [1, 2],
    });
    expect(result).toEqual([
      { id: 1, slackUserId: 'U1', pendingFollowUpCount: 2 },
      { id: 2, slackUserId: 'U1', pendingFollowUpCount: 0 },
    ]);
  });
  it('빈 목록은 집계를 조회하지 않는다', async () => {
    const countPendingFollowUps = jest.fn();
    const repository = {
      countPendingFollowUps,
    } as unknown as ScheduleRepositoryPort;
    expect(
      await new ScheduleFollowUpUsecase(repository).withPendingCounts([]),
    ).toEqual([]);
    expect(countPendingFollowUps).not.toHaveBeenCalled();
  });
  it('남의 연락할 일 수정은 404로 답한다', async () => {
    const repository = {
      updateFollowUp: jest.fn().mockResolvedValue(null),
    } as unknown as ScheduleRepositoryPort;
    const usecase = new ScheduleFollowUpUsecase(repository);
    await expect(
      usecase.update({ id: 1, slackUserId: 'U1', topic: '수정' }),
    ).rejects.toThrow(NotFoundException);
    expect(repository.updateFollowUp).toHaveBeenCalledWith({
      id: 1,
      slackUserId: 'U1',
      topic: '수정',
    });
  });
});
