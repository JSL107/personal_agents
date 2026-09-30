import {
  addKrxTradingDays,
  holidayCalendarOf,
  isKrxTradingDay,
  isPublicBusinessDay,
  krxYearEndClosureOf,
  latestKrxTradingDayOnOrBefore,
  nextKrxTradingDay,
} from './business-calendar';

const date = (text: string): Date => new Date(`${text}T00:00:00.000Z`);

// 2026-09-30 `schedule_item.is_holiday` 에 실제로 들어 있는 추석 전후 행.
const CHUSEOK_2026 = holidayCalendarOf([
  '2026-09-24',
  '2026-09-25',
  '2026-09-26',
  '2026-10-03',
  '2026-10-05',
  '2026-10-09',
]);

describe('KRX 달력 — 2026 추석 주(9/23~9/29)', () => {
  it.each([
    ['2026-09-23', true],
    ['2026-09-24', false],
    ['2026-09-25', false],
    ['2026-09-26', false],
    ['2026-09-27', false],
    ['2026-09-28', true],
    ['2026-09-29', true],
  ])('%s 거래일 여부 = %s', (dateText, expected) => {
    expect(isKrxTradingDay(date(dateText), CHUSEOK_2026)).toBe(expected);
  });

  it('09-23 저녁 추천의 목표 거래일은 휴장 사흘을 건너뛴 09-28 이다', () => {
    // 추천은 19:30 KST(= 10:30 UTC) 에 결정된다. 시각이 붙어 있어도 날짜로만 계산한다.
    expect(
      nextKrxTradingDay(new Date('2026-09-23T10:30:00.000Z'), CHUSEOK_2026),
    ).toEqual(date('2026-09-28'));
  });

  it('09-23 체결분의 T+2 결제일은 09-29 이다 (주말만 건너뛰면 09-25 로 틀린다)', () => {
    expect(addKrxTradingDays(date('2026-09-23'), 2, CHUSEOK_2026)).toEqual(
      date('2026-09-29'),
    );
  });

  it('휴장 금요일(09-25)의 직전 거래일은 09-23 이다', () => {
    expect(
      latestKrxTradingDayOnOrBefore(date('2026-09-25'), CHUSEOK_2026),
    ).toEqual(date('2026-09-23'));
  });

  it('거래일이면 그 날을 그대로 돌려준다', () => {
    expect(
      latestKrxTradingDayOnOrBefore(date('2026-09-28'), CHUSEOK_2026),
    ).toEqual(date('2026-09-28'));
  });

  it('개천절 대체공휴일(10/5)도 건너뛴다', () => {
    expect(nextKrxTradingDay(date('2026-10-02'), CHUSEOK_2026)).toEqual(
      date('2026-10-06'),
    );
  });
});

describe('KRX 연말 휴장일', () => {
  // 2021~2025 국내 `daily_price` 로 확인한 실제 휴장일. 성탄절은 각 해의 공휴일로 넣는다.
  it.each([
    ['2021', '2021-12-31'],
    ['2022', '2022-12-30'],
    ['2023', '2023-12-29'],
    ['2024', '2024-12-31'],
    ['2025', '2025-12-31'],
  ])('%s년 연말 휴장일은 %s 이다', (year, expected) => {
    const calendar = holidayCalendarOf([`${year}-12-25`]);

    expect(krxYearEndClosureOf(Number(year), calendar)).toEqual(date(expected));
    expect(isKrxTradingDay(date(expected), calendar)).toBe(false);
  });

  it('31일이 주말인 해에는 31일 전 평일만 쉬고 그 앞날은 연다', () => {
    const calendar = holidayCalendarOf(['2023-12-25']);

    expect(isKrxTradingDay(date('2023-12-28'), calendar)).toBe(true);
    expect(isKrxTradingDay(date('2023-12-29'), calendar)).toBe(false);
  });

  it('연말 휴장일은 공휴일 달력에서는 평일이다 (휴가 일수는 세야 한다)', () => {
    expect(isPublicBusinessDay(date('2026-12-31'), holidayCalendarOf([]))).toBe(
      true,
    );
    expect(isKrxTradingDay(date('2026-12-31'), holidayCalendarOf([]))).toBe(
      false,
    );
  });

  it('12/30 다음 거래일은 연말 휴장과 신정을 건너뛴다', () => {
    const calendar = holidayCalendarOf(['2026-12-25', '2027-01-01']);

    expect(nextKrxTradingDay(date('2026-12-30'), calendar)).toEqual(
      date('2027-01-04'),
    );
  });
});

describe('공휴일 데이터가 비어 있을 때', () => {
  it('주말만 쉬는 것으로 본다 (조용히 틀리지 않도록 경고는 읽는 쪽이 남긴다)', () => {
    const empty = holidayCalendarOf([]);

    expect(isKrxTradingDay(date('2026-09-24'), empty)).toBe(true);
    expect(nextKrxTradingDay(date('2026-08-14'), empty)).toEqual(
      date('2026-08-17'),
    );
  });
});
