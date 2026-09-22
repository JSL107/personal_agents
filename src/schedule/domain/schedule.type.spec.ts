import { canTransition, ScheduleStatus } from './schedule.type';

describe('canTransition', () => {
  it('OPEN 에서 DONE 으로 갈 수 있다', () => {
    expect(canTransition(ScheduleStatus.OPEN, ScheduleStatus.DONE)).toBe(true);
  });

  it('OPEN 에서 SKIPPED 로 갈 수 있다', () => {
    expect(canTransition(ScheduleStatus.OPEN, ScheduleStatus.SKIPPED)).toBe(
      true,
    );
  });

  it('DONE 에서 다시 OPEN 으로 돌아갈 수 있다', () => {
    expect(canTransition(ScheduleStatus.DONE, ScheduleStatus.OPEN)).toBe(true);
  });

  it('같은 상태로의 전이는 막는다', () => {
    expect(canTransition(ScheduleStatus.DONE, ScheduleStatus.DONE)).toBe(false);
  });
});
