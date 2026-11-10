import { specialDayContextOf } from './special-day-calendar';

describe('specialDayContextOf', () => {
  it('정오 전 입춘(2027-02-04 10:46) — 절입 직후 흐름은 정미년 임인월', () => {
    expect(specialDayContextOf('2027-02-04')).toEqual({
      seollalDate: '2027-02-07',
      solarTermToday: { name: '입춘', timeKst: '10:46' },
      ipchun: { date: '2027-02-04', timeKst: '10:46' },
      termFlow: { yearPillar: '丁未', monthPillar: '壬寅' },
    });
  });

  // 정오 대표값(丁未·癸丑)과 달리 절입 직후 값은 새해다 — 특집이 "오늘 16시 31분부터" 를 말하는 근거.
  it('정오 뒤 입춘(2028-02-04 16:31) — 절입 직후 흐름은 무신년 갑인월', () => {
    const context = specialDayContextOf('2028-02-04');

    expect(context.solarTermToday).toEqual({ name: '입춘', timeKst: '16:31' });
    expect(context.termFlow).toEqual({
      yearPillar: '戊申',
      monthPillar: '甲寅',
    });
  });

  // SolarTerm.date 는 UTC 순간이라 UTC 날짜로 보면 하루 앞당겨진다(2026 동지 UTC 12-21 20:50).
  it('KST 날짜로 판정한다 — 동지 2026-12-22 05:50, 전날은 아님', () => {
    const context = specialDayContextOf('2026-12-22');

    expect(context.solarTermToday).toEqual({ name: '동지', timeKst: '05:50' });
    expect(context.termFlow).toBeUndefined();
    expect(specialDayContextOf('2026-12-21').solarTermToday).toBeUndefined();
  });

  it('자정 직후 절입(2027-11-08 00:39 입동)도 그날이다', () => {
    expect(specialDayContextOf('2027-11-08').solarTermToday).toEqual({
      name: '입동',
      timeKst: '00:39',
    });
  });

  it('8절기 밖의 절기(경칩)는 특집이 아니다', () => {
    expect(specialDayContextOf('2027-03-06').solarTermToday).toBeUndefined();
  });

  it.each([
    ['2027-03-10', '2027-02-07'],
    ['2028-06-01', '2028-01-27'],
  ])('%s 의 해 설날은 %s', (todayKst, seollalDate) => {
    expect(specialDayContextOf(todayKst).seollalDate).toBe(seollalDate);
  });

  it('음력 변환 범위 밖(2101)이면 설날만 빼고 계속한다', () => {
    const context = specialDayContextOf('2101-01-01');

    expect(context.seollalDate).toBeUndefined();
    expect(context.ipchun.date).toMatch(/^2101-02-0\d$/);
  });
});
