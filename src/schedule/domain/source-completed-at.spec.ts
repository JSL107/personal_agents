import { toSourceCompletedAt } from './source-completed-at';

describe('toSourceCompletedAt', () => {
  const now = new Date('2026-11-05T10:00:00.000Z');

  it('지난 원천 시각은 그대로 쓴다', () => {
    expect(toSourceCompletedAt('2026-11-05T09:00:00.000Z', now)).toEqual(
      new Date('2026-11-05T09:00:00.000Z'),
    );
  });

  it('원천 시계가 빨라 미래면 now 로 낮춘다', () => {
    expect(toSourceCompletedAt('2026-11-05T10:00:05.000Z', now)).toBe(now);
  });

  it('없거나 해석할 수 없으면 now', () => {
    expect(toSourceCompletedAt(null, now)).toBe(now);
    expect(toSourceCompletedAt('not-a-date', now)).toBe(now);
  });
});
