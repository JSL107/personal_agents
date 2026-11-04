import { checkTransition, isUnfinished, ScheduleStatus } from './schedule.type';

describe('업무 트래킹 전이', () => {
  it('같은 상태와 후보 및 공휴일 진행 전이를 거부한다', () => {
    expect(
      checkTransition({
        from: ScheduleStatus.OPEN,
        to: ScheduleStatus.OPEN,
        isHoliday: false,
      }),
    ).toBe('SAME_STATUS');
    expect(
      checkTransition({
        from: ScheduleStatus.IN_PROGRESS,
        to: ScheduleStatus.CANDIDATE,
        isHoliday: false,
      }),
    ).toBe('TO_CANDIDATE');
    expect(
      checkTransition({
        from: ScheduleStatus.OPEN,
        to: ScheduleStatus.IN_PROGRESS,
        isHoliday: true,
      }),
    ).toBe('HOLIDAY_IN_PROGRESS');
    expect(
      checkTransition({
        from: ScheduleStatus.DONE,
        to: ScheduleStatus.OPEN,
        isHoliday: false,
      }),
    ).toBeNull();
    expect(
      checkTransition({
        from: ScheduleStatus.CANDIDATE,
        to: ScheduleStatus.DONE,
        isHoliday: false,
      }),
    ).toBeNull();
    expect(
      [
        ScheduleStatus.OPEN,
        ScheduleStatus.IN_PROGRESS,
        ScheduleStatus.CANDIDATE,
      ].every(isUnfinished),
    ).toBe(true);
    expect(
      isUnfinished(ScheduleStatus.DONE) || isUnfinished(ScheduleStatus.SKIPPED),
    ).toBe(false);
  });
});
