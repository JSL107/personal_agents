import { dayPillarOf } from '../domain/day-pillar';
import { natalPillarsOf } from './natal-pillars';

describe('natalPillarsOf', () => {
  // 2024 입춘은 02-04 17:27 KST — 그 전후로 년주·월주가 갈린다.
  it.each([
    [10, ['癸卯', '乙丑', '戊戌', '丁巳']],
    [18, ['甲辰', '丙寅', '戊戌', '辛酉']],
  ])('입춘 당일 %i시 출생', (hour, pillars) => {
    expect(
      natalPillarsOf({
        year: 2024,
        month: 2,
        day: 4,
        time: { hour, minute: 0 },
      }),
    ).toEqual({ pillars, warnings: [] });
  });

  it('시각을 모르면 기둥 3개를 내고, 절입일이면 경고한다', () => {
    const { pillars, warnings } = natalPillarsOf({
      year: 2024,
      month: 2,
      day: 4,
    });

    expect(pillars).toHaveLength(3);
    expect(pillars[2]).toBe(dayPillarOf('2024-02-04'));
    expect(warnings).toEqual([expect.stringContaining('절입일')]);
  });

  it('절입일이 아니면 시각 없이도 경고가 없다', () => {
    expect(natalPillarsOf({ year: 2026, month: 11, day: 10 })).toEqual({
      pillars: ['丙午', '己亥', dayPillarOf('2026-11-10')],
      warnings: [],
    });
  });

  // 음력 2023-01-01 = 양력 01-22(설날), 음력 윤2월 1일 = 양력 03-22.
  it.each([
    [
      { month: 1, day: 1, isLeapMonth: false },
      { month: 1, day: 22 },
    ],
    [
      { month: 2, day: 1, isLeapMonth: true },
      { month: 3, day: 22 },
    ],
  ])('음력 %o 는 양력 %o 와 같은 기둥', (lunar, solar) => {
    expect(natalPillarsOf({ year: 2023, ...lunar, isLunar: true })).toEqual(
      natalPillarsOf({ year: 2023, ...solar }),
    );
  });

  it('없는 윤달은 끊는다', () => {
    expect(() =>
      natalPillarsOf({
        year: 2023,
        month: 3,
        day: 1,
        isLunar: true,
        isLeapMonth: true,
      }),
    ).toThrow(RangeError);
  });

  it('서머타임 기간 시각은 한 시간 당겨 본다 (1987-07-15 13:40 → 12:40)', () => {
    expect(
      natalPillarsOf({
        year: 1987,
        month: 7,
        day: 15,
        time: { hour: 13, minute: 40 },
      }).pillars[3],
    ).toBe('壬午');
  });

  it('진태양시는 경도를 줄 때만 고친다', () => {
    const birth = {
      year: 1995,
      month: 3,
      day: 10,
      time: { hour: 13, minute: 20 },
    };

    expect(natalPillarsOf(birth).pillars[3]).toBe('癸未');
    expect(
      natalPillarsOf({ ...birth, solarTimeLongitude: 126.98 }).pillars[3],
    ).toBe('壬午');
    expect(natalPillarsOf(birth).warnings).toEqual([
      expect.stringContaining('시진 경계'),
    ]);
  });

  it('시진 한가운데는 경고하지 않는다', () => {
    expect(
      natalPillarsOf({
        year: 1995,
        month: 3,
        day: 10,
        time: { hour: 14, minute: 0 },
      }).warnings,
    ).toEqual([]);
  });

  it('밤 11시대는 자시 처리에 따라 일주가 갈린다고 경고한다', () => {
    const birth = {
      year: 1995,
      month: 3,
      day: 10,
      time: { hour: 23, minute: 30 },
    };

    expect(natalPillarsOf(birth).pillars.slice(2)).toEqual(['庚子', '丙子']);
    const nextDay = natalPillarsOf({ ...birth, dayBoundary: 'jasi' });
    expect(nextDay.pillars.slice(2)).toEqual(['辛丑', '戊子']);
    expect(nextDay.warnings).toEqual([expect.stringContaining('밤 11시대')]);
  });
});
