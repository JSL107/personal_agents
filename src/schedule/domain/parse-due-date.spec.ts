import { parseDueDate, plainDateToUtcDate, todayInKst } from './parse-due-date';

const TODAY = { year: 2026, month: 9, day: 18 };

describe('parseDueDate — 절대 표현', () => {
  it('9월 30일', () => {
    expect(parseDueDate('9월 30일 자동차세', TODAY)).toEqual({
      year: 2026,
      month: 9,
      day: 30,
    });
  });

  it('2026-10-05', () => {
    expect(parseDueDate('2026-10-05 건강검진', TODAY)).toEqual({
      year: 2026,
      month: 10,
      day: 5,
    });
  });

  it('9/30', () => {
    expect(parseDueDate('9/30 자동차세', TODAY)).toEqual({
      year: 2026,
      month: 9,
      day: 30,
    });
  });

  it('이미 지난 월/일은 내년으로 넘긴다', () => {
    expect(parseDueDate('1월 5일 정산', TODAY)).toEqual({
      year: 2027,
      month: 1,
      day: 5,
    });
  });
});

describe('parseDueDate — 상대 표현', () => {
  it('내일', () => {
    expect(parseDueDate('내일 서류 제출', TODAY)).toEqual({
      year: 2026,
      month: 9,
      day: 19,
    });
  });

  it('모레', () => {
    expect(parseDueDate('모레 예약', TODAY)).toEqual({
      year: 2026,
      month: 9,
      day: 20,
    });
  });

  it('다음주 월요일 — 2026-09-18 은 금요일이므로 09-21', () => {
    expect(parseDueDate('다음주 월요일 신청', TODAY)).toEqual({
      year: 2026,
      month: 9,
      day: 21,
    });
  });

  it('9월 말은 그 달 마지막 날', () => {
    expect(parseDueDate('9월 말 정산', TODAY)).toEqual({
      year: 2026,
      month: 9,
      day: 30,
    });
  });
});

describe('parseDueDate — 거부', () => {
  it('날짜가 없으면 null', () => {
    expect(parseDueDate('자동차세 내야 함', TODAY)).toBeNull();
  });

  it('달력에 없는 날짜는 null — 2월 30일이 3월로 넘어가면 안 된다', () => {
    expect(parseDueDate('2월 30일 정산', TODAY)).toBeNull();
  });

  it('13월은 null', () => {
    expect(parseDueDate('13월 1일 정산', TODAY)).toBeNull();
  });
});

describe('plainDateToUtcDate', () => {
  it('@db.Date 컬럼에 날짜가 하루 밀리지 않도록 UTC 자정으로 만든다', () => {
    const converted = plainDateToUtcDate({ year: 2026, month: 9, day: 30 });
    expect(converted.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });
});

describe('todayInKst', () => {
  it('UTC 자정 직후에도 KST 기준 날짜를 준다', () => {
    expect(todayInKst(new Date('2026-09-17T15:30:00.000Z'))).toEqual({
      year: 2026,
      month: 9,
      day: 18,
    });
  });
});
