import { parseDateParam } from './parse-date-param';

describe('parseDateParam', () => {
  it('정상 날짜를 통과시킨다', () => {
    expect(parseDateParam('2026-09-30', 'from').toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('형식이 아니면 던진다', () => {
    expect(() => parseDateParam('어제', 'from')).toThrow();
  });

  it('달력에 없는 날짜는 던진다 — new Date 가 3월로 굴리는 것을 막는다', () => {
    expect(() => parseDateParam('2026-02-31', 'to')).toThrow();
  });
});
