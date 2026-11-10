import {
  isBirthdayOn,
  renderSpecialDayLine,
  SpecialDay,
  SpecialDayContext,
  SpecialDayKind,
  specialDaysOf,
  SpecialSolarTerm,
} from './special-day';

const EMPTY_CONTEXT: SpecialDayContext = {
  ipchun: { date: '2027-02-04', timeKst: '10:46' },
};

describe('isBirthdayOn', () => {
  it.each([
    ['05-17', '2027-05-17', true],
    ['05-17', '2027-05-18', false],
    // 02-29 생일은 윤년이 아닌 해에 02-28 로 본다.
    ['02-29', '2027-02-28', true],
    ['02-29', '2028-02-28', false],
    ['02-29', '2028-02-29', true],
  ])('생일 %s · 오늘 %s → %s', (birthday, todayKst, expected) => {
    expect(isBirthdayOn({ birthday, todayKst })).toBe(expected);
  });

  it('생일이 없으면 false', () => {
    expect(isBirthdayOn({ todayKst: '2027-05-17' })).toBe(false);
  });
});

describe('specialDaysOf', () => {
  it('겹치면 생일 → 설날 → 새해 → 절기 순서로 낸다', () => {
    const days = specialDaysOf({
      todayKst: '2038-02-04',
      birthday: '02-04',
      context: {
        seollalDate: '2038-02-04',
        solarTermToday: { name: SpecialSolarTerm.입춘, timeKst: '08:00' },
        ipchun: { date: '2038-02-04', timeKst: '08:00' },
      },
    });

    expect(days.map(({ kind }) => kind)).toEqual([
      'birthday',
      'seollal',
      'solarTerm',
    ]);
    expect(days[2]).toEqual({
      kind: SpecialDayKind.SOLAR_TERM,
      solarTerm: { name: '입춘', timeKst: '08:00' },
    });
  });

  it('1월 1일은 새해다', () => {
    expect(
      specialDaysOf({ todayKst: '2027-01-01', context: EMPTY_CONTEXT }),
    ).toEqual([{ kind: 'newYear' }]);
  });

  it('평범한 날은 비어 있다', () => {
    expect(
      specialDaysOf({
        todayKst: '2027-03-10',
        birthday: '05-17',
        context: EMPTY_CONTEXT,
      }),
    ).toEqual([]);
  });
});

describe('renderSpecialDayLine', () => {
  const cases: [SpecialDay, string][] = [
    [{ kind: SpecialDayKind.BIRTHDAY }, '🎂 생일 축하해, 길동!'],
    [{ kind: SpecialDayKind.SEOLLAL }, '🧧 설날이야 — 새 한 해가 열리는 날'],
    [{ kind: SpecialDayKind.NEW_YEAR }, '🎍 새해 첫날이야'],
    [
      {
        kind: SpecialDayKind.SOLAR_TERM,
        solarTerm: { name: SpecialSolarTerm.입춘, timeKst: '10:46' },
      },
      '🌱 오늘은 입춘 — 봄이 시작되는 날',
    ],
    [
      {
        kind: SpecialDayKind.SOLAR_TERM,
        solarTerm: { name: SpecialSolarTerm.동지, timeKst: '05:50' },
      },
      '🌙 오늘은 동지 — 밤이 가장 긴 날',
    ],
  ];

  it.each(cases)('%o', (day, expected) => {
    expect(renderSpecialDayLine({ day, name: '길동' })).toBe(expected);
  });
});
