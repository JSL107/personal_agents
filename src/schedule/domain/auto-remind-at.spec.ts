import { computeAutoRemindAt } from './auto-remind-at';

describe('computeAutoRemindAt', () => {
  it('마감 1시간 전의 KST 시각이 미래일 때 UTC로 돌려준다', () => {
    const dueDate = new Date('2026-11-05T00:00:00Z');
    expect(
      computeAutoRemindAt({
        dueDate,
        dueTime: '15:00',
        now: new Date('2026-11-05T04:00:00Z'),
      }),
    ).toEqual(new Date('2026-11-05T05:00:00Z'));
    expect(
      computeAutoRemindAt({
        dueDate,
        dueTime: '15:00',
        now: new Date('2026-11-05T05:30:00Z'),
      }),
    ).toBeNull();
  });
});
