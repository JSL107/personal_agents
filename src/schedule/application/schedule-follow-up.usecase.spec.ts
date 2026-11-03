import { NotFoundException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleFollowUpUsecase } from './schedule-follow-up.usecase';

describe('ScheduleFollowUpUsecase', () => {
  it('목록에 연락할 일 미발송 개수를 붙인다', async () => {
    const repository = {
      findDetail: jest.fn().mockResolvedValue({ pendingFollowUpCount: 2 }),
    } as unknown as ScheduleRepositoryPort;
    const usecase = new ScheduleFollowUpUsecase(repository);
    const items = [{ id: 1, slackUserId: 'U1' }] as never;
    const result = await usecase.withPendingCounts(items);
    expect(result).toEqual([
      { id: 1, slackUserId: 'U1', pendingFollowUpCount: 2 },
    ]);
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
