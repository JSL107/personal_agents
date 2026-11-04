import { NotFoundException } from '@nestjs/common';

import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleEventKind } from '../domain/schedule.type';
import { ScheduleFollowUpUsecase } from './schedule-follow-up.usecase';

describe('ScheduleFollowUpUsecase', () => {
  it('상세 응답에 PR 연결 이벤트만 별도 목록으로 담는다', async () => {
    const linked = {
      id: 1,
      scheduleItemId: 2,
      kind: ScheduleEventKind.PR_LINKED,
      payload: { number: 963 },
      dedupeKey: null,
      occurredAt: new Date('2026-11-04T00:00:00.000Z'),
    };
    const noted = { ...linked, id: 2, kind: ScheduleEventKind.NOTE };
    const detail = {
      item: { id: 2 },
      followUps: [],
      events: [linked, noted],
      pendingFollowUpCount: 0,
    };
    const repository = {
      findDetail: jest.fn().mockResolvedValue(detail),
    } as unknown as ScheduleRepositoryPort;
    const result = await new ScheduleFollowUpUsecase(repository).detail({
      id: 2,
      slackUserId: 'U1',
    });
    expect(result).toEqual({ ...detail, linkedPullRequests: [linked] });
    expect(result.events).toEqual([linked, noted]);
  });

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
