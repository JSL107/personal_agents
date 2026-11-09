import { calculateFourPillars } from 'manseryeok';

import { dayPillarOf, pillarFromHangul } from './day-pillar';
import { yearMonthPillarsOf } from './year-month-pillar';

const MILLISECONDS_PER_DAY = 86_400_000;

describe('yearMonthPillarsOf', () => {
  // 2026 입춘은 02-04 05:02 KST, 입동은 11-07 — 정오 기준이라 입춘 당일은 새해 기둥이다.
  it.each([
    ['2026-02-03', '乙巳', '己丑'],
    ['2026-02-04', '丙午', '庚寅'],
    ['2026-11-06', '丙午', '戊戌'],
    ['2026-11-09', '丙午', '己亥'],
  ])('%s → %s년 %s월', (plainDate, yearPillar, monthPillar) => {
    expect(yearMonthPillarsOf(plainDate)).toEqual({ yearPillar, monthPillar });
  });

  it('형식이 틀리거나 달력에 없는 날은 끊는다', () => {
    expect(() => yearMonthPillarsOf('2026/11/09')).toThrow('날짜 형식 오류');
    expect(() => yearMonthPillarsOf('2026-02-30')).toThrow(RangeError);
  });
});

describe('dayPillarOf 와 manseryeok 교차 대조', () => {
  // 일진은 레포가 직접 세고 년주·월주는 라이브러리에 맡긴다 — 둘이 같은 달력을 보는지 전 구간에서 확인한다.
  it('1900~2100 년 모든 날의 일주가 같다', () => {
    const mismatches: string[] = [];
    for (
      let time = Date.UTC(1900, 0, 1);
      time <= Date.UTC(2100, 11, 31);
      time += MILLISECONDS_PER_DAY
    ) {
      const date = new Date(time);
      const plainDate = date.toISOString().slice(0, 10);
      const { day } = calculateFourPillars({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: 12,
        minute: 0,
      });
      if (
        dayPillarOf(plainDate) !==
        pillarFromHangul(day.heavenlyStem, day.earthlyBranch)
      ) {
        mismatches.push(plainDate);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
