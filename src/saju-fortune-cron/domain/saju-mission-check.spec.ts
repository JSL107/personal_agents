import { MissionResult } from './port/saju-fortune-day.repository.port';
import { isMissionCheckDue } from './saju-mission-check';

const NOW = new Date('2026-11-10T12:00:00Z').getTime();
const dayOf = (overrides: Record<string, unknown> = {}) => ({
  fortuneDate: '2026-11-10',
  missionText: '물 한 컵 천천히 마시기',
  createdAt: new Date('2026-11-09T23:00:00Z'),
  ...overrides,
});

describe('isMissionCheckDue', () => {
  it('아침에 보냈고 아직 답이 없고 3시간이 지났으면 묻는다', () => {
    expect(isMissionCheckDue({ day: dayOf(), nowMs: NOW })).toBe(true);
  });

  it('이미 답했으면 묻지 않는다', () => {
    const day = dayOf({ missionResult: MissionResult.NOT_DONE });

    expect(isMissionCheckDue({ day, nowMs: NOW })).toBe(false);
  });

  it('아침 운세를 받은 지 3시간이 안 됐으면 묻지 않는다', () => {
    const day = dayOf({ createdAt: new Date('2026-11-10T09:30:00Z') });

    expect(isMissionCheckDue({ day, nowMs: NOW })).toBe(false);
  });
});
