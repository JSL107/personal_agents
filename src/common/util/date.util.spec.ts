import { pickLatestDateTime } from './date.util';

describe('pickLatestDateTime', () => {
  it('순서와 무관하게 가장 늦은 시각을 원래 문자열 그대로 돌려준다', () => {
    expect(
      pickLatestDateTime([
        '2026-10-20T00:00:00Z',
        '2026-11-16T08:45:46Z',
        '2026-10-26T09:00:21Z',
      ]),
    ).toBe('2026-11-16T08:45:46Z');
  });

  it('표기 형식이 달라도 실제 시각으로 비교한다', () => {
    expect(
      pickLatestDateTime(['2026-11-16T09:00:00+09:00', '2026-11-16T00:30:00Z']),
    ).toBe('2026-11-16T00:30:00Z');
  });

  it('하나뿐이면 그것을 돌려준다', () => {
    expect(pickLatestDateTime(['2026-10-20T00:00:00Z'])).toBe(
      '2026-10-20T00:00:00Z',
    );
  });
});
