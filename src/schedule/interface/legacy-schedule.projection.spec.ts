import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import {
  projectForLegacy,
  projectItemForLegacy,
} from './legacy-schedule.projection';

describe('옛 콘솔 앱 일정 투영', () => {
  const base: ScheduleItemRecord = {
    id: 1,
    slackUserId: 'U1',
    title: '업무',
    dueDate: new Date('2026-11-05'),
    dueTime: null,
    linkUrl: null,
    memo: null,
    status: ScheduleStatus.OPEN,
    completedAt: null,
    isHoliday: false,
  };

  it('목록에서 진행 중은 OPEN으로 보이고 후보와 기한 없는 업무는 제외한다', () => {
    const items = [
      { ...base, id: 1, status: ScheduleStatus.IN_PROGRESS },
      { ...base, id: 2, status: ScheduleStatus.CANDIDATE },
      { ...base, id: 3, dueDate: null },
    ];
    expect(projectForLegacy(items)).toEqual([
      { ...items[0], status: ScheduleStatus.OPEN },
    ]);
  });

  it('PATCH의 단일 응답도 진행 중 상태를 OPEN으로 투영한다', () => {
    expect(
      projectItemForLegacy({ ...base, status: ScheduleStatus.IN_PROGRESS }),
    ).toEqual({ ...base, status: ScheduleStatus.OPEN });
  });
});
