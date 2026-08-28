import {
  normalizeWantedMaxYears,
  resolveExperienceLevel,
  resolveRallitLevel,
} from './experience';

describe('resolveRallitLevel', () => {
  it('실측 5종 등급을 연차 구간으로 옮긴다', () => {
    expect(resolveRallitLevel('BEGINNER')).toEqual({
      minYears: 0,
      maxYears: 1,
      experienceLevel: 'newcomer',
    });
    expect(resolveRallitLevel('JUNIOR')).toEqual({
      minYears: 1,
      maxYears: 3,
      experienceLevel: 'junior',
    });
    expect(resolveRallitLevel('MIDDLE')).toEqual({
      minYears: 3,
      maxYears: 7,
      experienceLevel: 'mid',
    });
    expect(resolveRallitLevel('SENIOR')).toEqual({
      minYears: 7,
      maxYears: null,
      experienceLevel: 'senior',
    });
    expect(resolveRallitLevel('IRRELEVANT')).toEqual({
      minYears: null,
      maxYears: null,
      experienceLevel: 'any',
    });
  });

  it('목록에 없는 등급은 경력 무관으로 둔다', () => {
    expect(resolveRallitLevel('EXECUTIVE')).toEqual({
      minYears: null,
      maxYears: null,
      experienceLevel: 'any',
    });
  });
});

describe('normalizeWantedMaxYears', () => {
  it('100 은 상한 없음을 뜻하는 표식이라 null 로 바꾼다', () => {
    expect(normalizeWantedMaxYears(100)).toBeNull();
  });

  it('100 을 넘는 값도 상한 없음으로 본다', () => {
    expect(normalizeWantedMaxYears(120)).toBeNull();
  });

  it('실제 상한은 그대로 둔다', () => {
    expect(normalizeWantedMaxYears(5)).toBe(5);
    expect(normalizeWantedMaxYears(0)).toBe(0);
  });

  it('없는 값은 null 이다', () => {
    expect(normalizeWantedMaxYears(null)).toBeNull();
  });
});

describe('resolveExperienceLevel', () => {
  it('소스가 신입 표식을 주면 그것을 우선한다', () => {
    expect(
      resolveExperienceLevel({ minYears: 3, maxYears: 5, isNewcomer: true }),
    ).toBe('newcomer');
  });

  it('구간이 모두 비면 경력 무관이다', () => {
    expect(
      resolveExperienceLevel({
        minYears: null,
        maxYears: null,
        isNewcomer: false,
      }),
    ).toBe('any');
  });

  it('랠릿 등급표와 경계를 맞춘다', () => {
    const at = (minYears: number, maxYears: number | null): string => {
      return resolveExperienceLevel({ minYears, maxYears, isNewcomer: false });
    };
    expect(at(7, null)).toBe('senior');
    expect(at(3, 10)).toBe('mid');
    expect(at(1, 10)).toBe('junior');
    expect(at(0, 1)).toBe('newcomer');
    expect(at(0, 10)).toBe('junior');
  });

  it('실측 점핏 값을 등급으로 옮긴다', () => {
    expect(
      resolveExperienceLevel({ minYears: 5, maxYears: 20, isNewcomer: false }),
    ).toBe('mid');
    expect(
      resolveExperienceLevel({ minYears: 7, maxYears: 20, isNewcomer: false }),
    ).toBe('senior');
  });
});
