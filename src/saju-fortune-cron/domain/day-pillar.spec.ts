import { dayPillarOf, isValidPillar, pillarToHangul } from './day-pillar';

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

  it('형식은 맞아도 달력에 없는 날이면 던진다', () => {
    expect(() => dayPillarOf('2026-02-30')).toThrow('달력에 없는 날');
    expect(() => dayPillarOf('2026-02-29')).toThrow('달력에 없는 날');
    expect(() => dayPillarOf('2026-13-01')).toThrow('달력에 없는 날');
    // 외부 확인한 2026-10-16(癸亥)과 960일(60의 배수) 차이.
    expect(dayPillarOf('2024-02-29')).toBe('癸亥');
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

describe('pillarToHangul', () => {
  // 코드의 독음표와 따로 적은 대응표 — 위치가 한 칸만 밀려도 여기서 걸린다.
  const STEM_READINGS: Record<string, string> = {
    甲: '갑',
    乙: '을',
    丙: '병',
    丁: '정',
    戊: '무',
    己: '기',
    庚: '경',
    辛: '신',
    壬: '임',
    癸: '계',
  };
  const BRANCH_READINGS: Record<string, string> = {
    子: '자',
    丑: '축',
    寅: '인',
    卯: '묘',
    辰: '진',
    巳: '사',
    午: '오',
    未: '미',
    申: '신',
    酉: '유',
    戌: '술',
    亥: '해',
  };

  it('60갑자 전부를 천간·지지 독음대로 바꾼다', () => {
    let checked = 0;
    for (const [stem, stemReading] of Object.entries(STEM_READINGS)) {
      for (const [branch, branchReading] of Object.entries(BRANCH_READINGS)) {
        if (!isValidPillar(stem + branch)) {
          continue;
        }
        expect(pillarToHangul(stem + branch)).toBe(stemReading + branchReading);
        checked++;
      }
    }
    expect(checked).toBe(60);
  });

  it('간지를 한글 독음으로 바꾼다', () => {
    expect(pillarToHangul('癸亥')).toBe('계해');
    expect(pillarToHangul('甲子')).toBe('갑자');
    expect(pillarToHangul('己巳')).toBe('기사');
    expect(pillarToHangul('庚辰')).toBe('경진');
  });
});
