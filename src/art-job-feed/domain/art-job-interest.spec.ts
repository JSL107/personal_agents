import { hasReminderLeft } from './art-job-interest';

const DEADLINE = { year: 2026, month: 10, day: 20 };
// KST 시각을 UTC Date 로 — 테스트가 어느 타임존에서 돌아도 같은 순간을 가리키게.
const kst = (day: number, hour: number) =>
  new Date(Date.UTC(2026, 9, day, hour - 9));

describe('hasReminderLeft', () => {
  it.each([
    [kst(18, 23), true],
    [kst(19, 12), true],
    [kst(19, 13), false],
    [kst(20, 8), false],
  ])('마감 10/20, 지금 %s → %s', (now, expected) => {
    expect(hasReminderLeft(DEADLINE, now)).toBe(expected);
  });
});
