import { dayPillarOf, isValidPillar } from './day-pillar';

describe('dayPillarOf', () => {
  // 정답은 만세력(datedb.net 2026-10-16 = 癸亥)과 2000-01-01 = 戊午 로 교차 확인한 값.
  it.each([
    ['1900-01-01', '甲戌'],
    ['2000-01-01', '戊午'],
    ['1984-02-29', '癸巳'],
    ['1987-03-14', '壬戌'],
    ['2001-05-09', '壬申'],
    ['2026-10-16', '癸亥'],
    ['2026-10-17', '甲子'],
    ['2027-01-01', '庚辰'],
    ['1899-12-31', '癸酉'],
  ])('%s 는 %s 일이다', (plainDate, expected) => {
    expect(dayPillarOf(plainDate)).toBe(expected);
  });

  it('형식이 아니면 던진다', () => {
    expect(() => dayPillarOf('2026/10/16')).toThrow('일진 계산 날짜 형식 오류');
  });
});

describe('isValidPillar', () => {
  it('60갑자 조합만 통과시킨다', () => {
    expect(isValidPillar('甲子')).toBe(true);
    expect(isValidPillar('癸亥')).toBe(true);
    expect(isValidPillar('甲丑')).toBe(false);
    expect(isValidPillar('갑자')).toBe(false);
    expect(isValidPillar('甲')).toBe(false);
  });
});
