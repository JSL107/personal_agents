import { match } from 'ts-pattern';

import { YearMonthPillars } from './saju-analysis';

// 특별한 날로 치는 절기 — 계절의 문턱 여덟 개(사용자 결정). 나머지 16절기는 특집을 내지 않는다.
export enum SpecialSolarTerm {
  입춘 = '입춘',
  춘분 = '춘분',
  입하 = '입하',
  하지 = '하지',
  입추 = '입추',
  추분 = '추분',
  입동 = '입동',
  동지 = '동지',
}

// 년·월주가 바뀌는 절(節). 춘분·하지·추분·동지 같은 중기는 간지를 바꾸지 않는다.
const FLOW_CHANGING_TERMS: readonly SpecialSolarTerm[] = [
  SpecialSolarTerm.입춘,
  SpecialSolarTerm.입하,
  SpecialSolarTerm.입추,
  SpecialSolarTerm.입동,
];

// 특집 줄의 이모지와 뜻 — 줄은 코드가 그리고, 뜻은 프롬프트 사실에도 같은 말로 싣는다.
interface SolarTermMeaning {
  emoji: string;
  meaning: string;
}

export const SOLAR_TERM_MEANINGS: Record<SpecialSolarTerm, SolarTermMeaning> = {
  입춘: { emoji: '🌱', meaning: '봄이 시작되는 날' },
  춘분: { emoji: '🌸', meaning: '낮과 밤이 같아지는 날' },
  입하: { emoji: '🌿', meaning: '여름이 시작되는 날' },
  하지: { emoji: '☀️', meaning: '낮이 가장 긴 날' },
  입추: { emoji: '🍂', meaning: '가을이 시작되는 날' },
  추분: { emoji: '🍁', meaning: '낮과 밤이 같아지는 날' },
  입동: { emoji: '❄️', meaning: '겨울이 시작되는 날' },
  동지: { emoji: '🌙', meaning: '밤이 가장 긴 날' },
};

export interface SolarTermToday {
  name: SpecialSolarTerm;
  // 절입 시각 KST 'HH:MM'.
  timeKst: string;
}

// 날짜 계산은 application(special-day-calendar)이 라이브러리로 해서 값으로 넘긴다 — domain 은 무의존.
export interface SpecialDayContext {
  // 'YYYY-MM-DD'. 음력 변환 범위 밖이면 없다.
  seollalDate?: string;
  solarTermToday?: SolarTermToday;
  // 올해 입춘 — 새해·설날 특집에 "사주의 새해는 입춘부터" 를 말할 때 쓴다.
  ipchun: { date: string; timeKst: string };
  // 오늘이 년·월주가 바뀌는 절일 때, 절입 직후의 년·월주.
  termFlow?: YearMonthPillars;
}

export enum SpecialDayKind {
  BIRTHDAY = 'birthday',
  SEOLLAL = 'seollal',
  NEW_YEAR = 'newYear',
  SOLAR_TERM = 'solarTerm',
}

// 절기 특집만 절기 정보를 갖는다 — 판별 유니온이라 갈래마다 타입이 좁혀진다.
interface CalendarSpecialDay {
  kind:
    | SpecialDayKind.BIRTHDAY
    | SpecialDayKind.SEOLLAL
    | SpecialDayKind.NEW_YEAR;
}

interface SolarTermSpecialDay {
  kind: SpecialDayKind.SOLAR_TERM;
  solarTerm: SolarTermToday;
}

export type SpecialDay = CalendarSpecialDay | SolarTermSpecialDay;

const NEW_YEAR_SUFFIX = '-01-01';
const LEAP_DAY = '02-29';
const LEAP_DAY_FALLBACK = '02-28';

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

// birthday 'MM-DD', todayKst 'YYYY-MM-DD'. 02-29 생일은 평년엔 02-28 에 챙긴다.
export const isBirthdayOn = ({
  birthday,
  todayKst,
}: {
  birthday?: string;
  todayKst: string;
}): boolean => {
  if (!birthday) {
    return false;
  }
  const year = Number(todayKst.slice(0, 4));
  if (birthday === LEAP_DAY && !isLeapYear(year)) {
    return todayKst.endsWith(`-${LEAP_DAY_FALLBACK}`);
  }
  return todayKst.endsWith(`-${birthday}`);
};

export const changesFlow = (term: SpecialSolarTerm): boolean =>
  FLOW_CHANGING_TERMS.includes(term);

// 순서 고정: 생일 → 설날 → 새해 → 절기. 한 메시지 안 단락 순서이기도 하다.
export const specialDaysOf = ({
  todayKst,
  birthday,
  context,
}: {
  todayKst: string;
  birthday?: string;
  context: SpecialDayContext;
}): SpecialDay[] => {
  const { seollalDate, solarTermToday } = context;
  const days: SpecialDay[] = [];
  if (isBirthdayOn({ birthday, todayKst })) {
    days.push({ kind: SpecialDayKind.BIRTHDAY });
  }
  if (seollalDate === todayKst) {
    days.push({ kind: SpecialDayKind.SEOLLAL });
  }
  if (todayKst.endsWith(NEW_YEAR_SUFFIX)) {
    days.push({ kind: SpecialDayKind.NEW_YEAR });
  }
  if (solarTermToday) {
    days.push({ kind: SpecialDayKind.SOLAR_TERM, solarTerm: solarTermToday });
  }
  return days;
};

// 특집 단락의 첫 줄 — 코드가 그린다.
// 특별한 날 종류가 늘면 .exhaustive() 가 빌드에서 잡는다(CODE_RULES §4).
export const renderSpecialDayLine = ({
  day,
  name,
}: {
  day: SpecialDay;
  name: string;
}): string => {
  const line = match(day)
    .with({ kind: SpecialDayKind.BIRTHDAY }, () => `🎂 생일 축하해, ${name}!`)
    .with(
      { kind: SpecialDayKind.SEOLLAL },
      () => '🧧 설날이야 — 새 한 해가 열리는 날',
    )
    .with({ kind: SpecialDayKind.NEW_YEAR }, () => '🎍 새해 첫날이야')
    .with({ kind: SpecialDayKind.SOLAR_TERM }, ({ solarTerm }) =>
      solarTermLineOf(solarTerm),
    )
    .exhaustive();
  return line;
};

const solarTermLineOf = ({ name }: SolarTermToday): string => {
  const { emoji, meaning } = SOLAR_TERM_MEANINGS[name];
  return `${emoji} 오늘은 ${name} — ${meaning}`;
};
