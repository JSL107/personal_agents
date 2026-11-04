import { resolveCollectionLowerBound } from './collection-window';

describe('resolveCollectionLowerBound', () => {
  it('첫 수집은 이번 달 1일 00:00 KST를 하한으로 삼는다', () => {
    expect(
      resolveCollectionLowerBound({
        lastSucceededAt: null,
        now: new Date('2026-11-04T02:00:00Z'),
      }).toISOString(),
    ).toBe('2026-10-31T15:00:00.000Z');
  });

  it('성공 기록이 있으면 두 시간을 되짚는다', () => {
    expect(
      resolveCollectionLowerBound({
        lastSucceededAt: new Date('2026-11-04T02:00:00Z'),
        now: new Date('2026-11-04T03:00:00Z'),
      }).toISOString(),
    ).toBe('2026-11-04T00:00:00.000Z');
  });
});
