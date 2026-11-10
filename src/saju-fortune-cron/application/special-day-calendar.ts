import {
  calculateFourPillars,
  getSolarTermsOfYear,
  lunarToSolar,
  SolarTerm,
} from 'manseryeok';

import {
  formatKstDateTime,
  getKstDateOf,
} from '../../common/util/kst-date.util';
import { pillarFromHangul } from '../domain/day-pillar';
import { YearMonthPillars } from '../domain/saju-analysis';
import {
  changesFlow,
  SolarTermToday,
  SpecialDayContext,
  SpecialSolarTerm,
} from '../domain/special-day';

// 특별한 날 판정에 필요한 날짜 값을 라이브러리로 구해 domain 에 값으로 넘긴다(year-month-pillar.ts 와 같은 경계).
// SolarTerm.date 는 UTC 순간이다 — 날짜·시각은 반드시 KST 로 바꿔 본다. UTC 날짜로 보면 8절기의 약 38%가
// 하루 앞당겨진다(2026 동지: KST 12-22 05:50 / UTC 12-21).
const MILLISECONDS_PER_MINUTE = 60_000;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

export const specialDayContextOf = (todayKst: string): SpecialDayContext => {
  const year = Number(todayKst.slice(0, 4));
  const terms = getSolarTermsOfYear(year);
  const ipchun = terms.find(({ name }) => name === SpecialSolarTerm.입춘);
  if (!ipchun) {
    throw new Error(`${year}년 입춘을 찾지 못함`);
  }
  const termToday = terms
    .map(toSpecialTerm)
    .find((term) => term !== undefined && term.date === todayKst);
  const seollalDate = seollalDateOf(year);

  const context: SpecialDayContext = {
    ...(seollalDate === undefined ? {} : { seollalDate }),
    ...(termToday === undefined ? {} : { solarTermToday: termToday.solarTerm }),
    ipchun: kstDateAndTimeOf(ipchun.date),
    ...(termToday?.flow === undefined ? {} : { termFlow: termToday.flow }),
  };
  return context;
};

interface SpecialTermOnDate {
  date: string;
  solarTerm: SolarTermToday;
  flow?: YearMonthPillars;
}

const toSpecialTerm = ({
  name,
  date,
}: SolarTerm): SpecialTermOnDate | undefined => {
  const specialName = Object.values(SpecialSolarTerm).find(
    (special) => special === name,
  );
  if (!specialName) {
    return undefined;
  }
  const { date: kstDate, timeKst } = kstDateAndTimeOf(date);
  const flow = changesFlow(specialName) ? flowRightAfter(date) : undefined;
  const term: SpecialTermOnDate = {
    date: kstDate,
    solarTerm: { name: specialName, timeKst },
    ...(flow === undefined ? {} : { flow }),
  };
  return term;
};

const kstDateAndTimeOf = (instant: Date): { date: string; timeKst: string } => {
  const date = getKstDateOf(instant);
  const timeKst = formatKstDateTime(instant).slice(-'HH:MM'.length);
  return { date, timeKst };
};

// 절입 1분 뒤의 년·월주 — 일일 운세의 정오 대표값과 달리 "오늘 이 시각부터 바뀌는 흐름" 이다.
// calculateFourPillars 는 보정 옵션 없이 부르면 입력을 KST 로 본다(year-month-pillar.ts 와 같은 기준).
const flowRightAfter = (termInstant: Date): YearMonthPillars => {
  const afterTerm = new Date(termInstant.getTime() + MILLISECONDS_PER_MINUTE);
  const matched = DATE_TIME_PATTERN.exec(formatKstDateTime(afterTerm));
  if (!matched) {
    throw new Error(`절입 시각 형식 오류: ${afterTerm.toISOString()}`);
  }
  const [, year, month, day, hour, minute] = matched.map(Number);
  const pillars = calculateFourPillars({ year, month, day, hour, minute });
  const flow: YearMonthPillars = {
    yearPillar: pillarFromHangul(
      pillars.year.heavenlyStem,
      pillars.year.earthlyBranch,
    ),
    monthPillar: pillarFromHangul(
      pillars.month.heavenlyStem,
      pillars.month.earthlyBranch,
    ),
  };
  return flow;
};

// 음력 변환은 1391~2100 년만 된다 — 범위 밖이면 설날만 판정하지 않는다(다른 특집·일일은 계속).
const seollalDateOf = (year: number): string | undefined => {
  try {
    const { month, day } = lunarToSolar(year, 1, 1, false);
    const seollalDate = `${year}-${pad(month)}-${pad(day)}`;
    return seollalDate;
  } catch (error) {
    if (error instanceof RangeError) {
      return undefined;
    }
    throw error;
  }
};

const pad = (value: number): string => String(value).padStart(2, '0');
