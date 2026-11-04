import { ScheduleSource } from './schedule.type';
import { buildScheduleItemRecord } from './schedule-item.fixture';
import { countTrackedDays } from './tracked-day-count';

describe('업무 일수', () => {
  const createdAt = new Date('2026-11-04T14:59:00Z');
  it('생성 당일은 1일째다', () => {
    expect(
      countTrackedDays({
        item: buildScheduleItemRecord({ createdAt }),
        now: createdAt,
      }),
    ).toBe(1);
  });
  it('KST 자정 직후는 2일째다', () => {
    expect(
      countTrackedDays({
        item: buildScheduleItemRecord({ createdAt }),
        now: new Date('2026-11-04T15:01:00Z'),
      }),
    ).toBe(2);
  });
  it('Notion 업무의 진행 시작은 기준일을 바꾸지 않는다', () => {
    expect(
      countTrackedDays({
        item: buildScheduleItemRecord({
          source: ScheduleSource.NOTION_TASK,
          createdAt,
          startedAt: new Date('2026-11-05T15:00:00Z'),
        }),
        now: new Date('2026-11-05T15:01:00Z'),
      }),
    ).toBe(3);
  });
  it('PR 은 시작일을 기준으로 한다', () => {
    expect(
      countTrackedDays({
        item: buildScheduleItemRecord({
          source: ScheduleSource.GITHUB_PR,
          createdAt: new Date('2026-11-05T15:00:00Z'),
          startedAt: createdAt,
        }),
        now: new Date('2026-11-05T15:01:00Z'),
      }),
    ).toBe(3);
  });
});
