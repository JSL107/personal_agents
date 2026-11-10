import { isCalendarDate } from '../../common/util/kst-date.util';

const HEAVENLY_STEMS = '甲乙丙丁戊己庚辛壬癸';
const EARTHLY_BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
// 위 두 줄과 같은 순서의 한글 독음.
const HEAVENLY_STEMS_HANGUL = '갑을병정무기경신임계';
const EARTHLY_BRANCHES_HANGUL = '자축인묘진사오미신유술해';
const SEXAGENARY_CYCLE = 60;
const MILLISECONDS_PER_DAY = 86_400_000;

// 1900-01-01 은 甲戌일(60갑자 10번째). 일진은 날짜가 하루 갈 때마다 60갑자를 한 칸씩 돌 뿐이라
// 기준일 하나와 날짜 차이만으로 정확히 나온다 — 절기·윤달이 필요한 년주·월주와 다르다.
// LLM 에 맡기면 50회 중 1회 틀렸다(2026-10-16 실측). 매일 바뀌는 값이라 코드로 확정한다.
const REFERENCE_DATE_UTC = Date.UTC(1900, 0, 1);
const REFERENCE_CYCLE_INDEX = 10;

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// plainDate: KST 기준 'YYYY-MM-DD'. 반환: '癸亥' 처럼 천간+지지 두 글자.
export const dayPillarOf = (plainDate: string): string => {
  const matched = PLAIN_DATE_PATTERN.exec(plainDate);
  if (!matched) {
    throw new Error(`일진 계산 날짜 형식 오류: ${plainDate}`);
  }
  const [, year, month, day] = matched;
  // Date.UTC 는 2026-02-30 을 03-02 로 조용히 넘긴다 — 달력 검증으로 다른 날의 일진을 내지 않게 막는다.
  if (!isCalendarDate(plainDate)) {
    throw new Error(`일진 계산 날짜 오류(달력에 없는 날): ${plainDate}`);
  }
  const dateUtc = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const daysFromReference = Math.round(
    (dateUtc - REFERENCE_DATE_UTC) / MILLISECONDS_PER_DAY,
  );
  const cycleIndex =
    (((daysFromReference + REFERENCE_CYCLE_INDEX) % SEXAGENARY_CYCLE) +
      SEXAGENARY_CYCLE) %
    SEXAGENARY_CYCLE;
  const pillar =
    HEAVENLY_STEMS[cycleIndex % HEAVENLY_STEMS.length] +
    EARTHLY_BRANCHES[cycleIndex % EARTHLY_BRANCHES.length];
  return pillar;
};

// 60갑자에 실제로 있는 조합인가 — 천간과 지지의 음양(짝홀)이 같아야 한다(甲丑 같은 조합은 없다).
export const isValidPillar = (pillar: string): boolean => {
  if (pillar.length !== 2) {
    return false;
  }
  const stemIndex = HEAVENLY_STEMS.indexOf(pillar[0]);
  const branchIndex = EARTHLY_BRANCHES.indexOf(pillar[1]);
  if (stemIndex < 0 || branchIndex < 0) {
    return false;
  }
  const isSameParity = stemIndex % 2 === branchIndex % 2;
  return isSameParity;
};

// '癸亥' → '계해'. 받는 사람에게 보이는 글에는 한자 대신 한글 독음을 쓴다.
export const pillarToHangul = (pillar: string): string => {
  const stem = HEAVENLY_STEMS_HANGUL[HEAVENLY_STEMS.indexOf(pillar[0])];
  const branch = EARTHLY_BRANCHES_HANGUL[EARTHLY_BRANCHES.indexOf(pillar[1])];
  const hangul = stem + branch;
  return hangul;
};

// '계', '해' → '癸亥'. manseryeok 이 한글 독음으로 돌려주는 기둥을 이 모듈의 한자 표기로 맞춘다.
export const pillarFromHangul = ({
  stem,
  branch,
}: {
  stem: string;
  branch: string;
}): string => {
  const hanjaStem = HEAVENLY_STEMS[HEAVENLY_STEMS_HANGUL.indexOf(stem)];
  const hanjaBranch = EARTHLY_BRANCHES[EARTHLY_BRANCHES_HANGUL.indexOf(branch)];
  const hanja = hanjaStem + hanjaBranch;
  return hanja;
};
