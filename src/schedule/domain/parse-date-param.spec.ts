import { parseDateParam, parsePlainDateParam } from './parse-date-param';
import { plainDateToUtcDate } from './parse-due-date';

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

describe('parsePlainDateParam', () => {
  it('정상 날짜를 PlainDate 로 쪼갠다', () => {
    expect(parsePlainDateParam('2026-09-30', 'dueDate')).toEqual({
      year: 2026,
      month: 9,
      day: 30,
    });
  });

  it('달력에 없는 날짜는 던진다 — parseDateParam 의 검사를 그대로 물려받는다', () => {
    expect(() => parsePlainDateParam('2026-02-31', 'dueDate')).toThrow();
  });

  // 이 케이스가 이 스위트의 존재 이유다. `parseDateParam` 은 통과시키지만 저장이 쓰는
  // `Date.UTC` 는 0~99 를 1900~1999 로 읽어, 통과한 날짜가 저장 직전에 다른 해로 앉는다.
  // 두 함수가 갈리는 지점이라 어느 한쪽만 보는 검사로는 절대 잡히지 않는다.
  it('저장이 다른 연도로 바꿔 놓는 날짜는 던진다 (0~99년)', () => {
    // 전제부터 고정한다 — 이 두 줄이 깨지면 위 방어의 이유 자체가 사라진 것이다.
    expect(new Date('0099-09-30').toISOString().slice(0, 10)).toBe(
      '0099-09-30',
    );
    expect(
      plainDateToUtcDate({ year: 99, month: 9, day: 30 })
        .toISOString()
        .slice(0, 10),
    ).toBe('1999-09-30');

    expect(() => parsePlainDateParam('0099-09-30', 'dueDate')).toThrow();
    expect(() => parsePlainDateParam('0000-01-01', 'dueDate')).toThrow();
  });
});
