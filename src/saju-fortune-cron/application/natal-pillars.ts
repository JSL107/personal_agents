import {
  calculateFourPillars,
  DayBoundary,
  DEFAULT_LONGITUDE,
  FourPillarsDetail,
  lunarToSolar,
  Pillar,
  TrueSolarTimeOptions,
} from 'manseryeok';

import { pillarFromHangul } from '../domain/day-pillar';

// 등록 스크립트(scripts/saju-pillars.ts)가 생년월일시로 SAJU_FORTUNE_RECIPIENTS 의 기둥을 뽑을 때 쓴다.
// 생년월일은 여기서 기둥으로만 바뀌고 어디에도 남지 않는다 — env 에는 기둥만 들어간다.

export interface BirthTime {
  hour: number;
  minute: number;
}

export interface NatalBirthInput {
  year: number;
  month: number;
  day: number;
  // 모르면 생략 — 기둥 3개(년·월·일)만 낸다.
  time?: BirthTime;
  isLunar?: boolean;
  isLeapMonth?: boolean;
  // 주면 진태양시(출생지 경도·균시차)까지 고친다. 만세력마다 쓰고 안 쓰고가 갈려 기본은 끈다.
  solarTimeLongitude?: number;
  dayBoundary?: DayBoundary;
}

interface WallClock extends BirthTime {
  year: number;
  month: number;
  day: number;
}

export interface NatalPillarsResult {
  // 년·월·일(·시) 한자 기둥.
  pillars: string[];
  // 입력이 조금만 달라도 기둥이 바뀌는 경우 — 사람이 다른 만세력과 대조해야 한다.
  warnings: string[];
}

// 과거 표준시(1954~61 UTC+8:30)·서머타임만 지금 KST 로 고친다. 기록된 사실의 보정이라 학파 차이가 없다.
// 경도 135(KST 기준 자오선)·균시차 끔이면 진태양시 보정은 0 이 된다.
const HISTORICAL_CLOCK_ONLY: TrueSolarTimeOptions = {
  longitude: 135,
  applyEquationOfTime: false,
};
// 시각을 모를 때 쓰는 대표 시각. 하루 안에서 기둥이 갈리는 날은 따로 경고한다.
const UNKNOWN_TIME: BirthTime = { hour: 12, minute: 0 };

export const natalPillarsOf = ({
  year,
  month,
  day,
  time,
  isLunar = false,
  isLeapMonth = false,
  solarTimeLongitude,
  dayBoundary = 'midnight',
}: NatalBirthInput): NatalPillarsResult => {
  const solarDate = isLunar
    ? lunarToSolar(year, month, day, isLeapMonth)
    : { year, month, day };
  const usesSolarTime = solarTimeLongitude !== undefined;
  const trueSolarTime = usesSolarTime
    ? { longitude: solarTimeLongitude }
    : HISTORICAL_CLOCK_ONLY;
  const pillarsAt = ({
    wallClock,
    options = trueSolarTime,
    boundary = dayBoundary,
  }: {
    wallClock: WallClock;
    options?: TrueSolarTimeOptions;
    boundary?: DayBoundary;
  }): FourPillarsDetail =>
    calculateFourPillars({
      ...wallClock,
      trueSolarTime: options,
      dayBoundary: boundary,
    });

  const found = pillarsAt({
    wallClock: { ...solarDate, ...(time ?? UNKNOWN_TIME) },
  });
  const pillars = [found.year, found.month, found.day].map(toHanja);
  const warnings: string[] = [];

  if (!time) {
    // 절입일이면 년·월주가, 서머타임 날(00시대가 전날 23시대로 보정)·진태양시면 일주가 하루 안에서 갈린다.
    const dayStart = pillarsAt({
      wallClock: { ...solarDate, hour: 0, minute: 0 },
    });
    const dayEnd = pillarsAt({
      wallClock: { ...solarDate, hour: 23, minute: 59 },
    });
    const changed = PILLAR_NAMES.slice(0, 3).filter((_, index) => {
      const startHanja = toHanja(pillarFields(dayStart)[index]);
      const endHanja = toHanja(pillarFields(dayEnd)[index]);
      return startHanja !== endHanja;
    });
    if (changed.length > 0) {
      warnings.push(
        `태어난 시각에 따라 ${changed.join('·')}가 바뀌는 날입니다. 시각을 알아야 정확합니다.`,
      );
    }
    return { pillars, warnings };
  }

  pillars.push(toHanja(found.hour));
  const birthClock: WallClock = { ...solarDate, ...time };
  // 진태양시는 경도·계절(균시차)에 따라 −14~−46분 남짓 움직여 고정 폭으로는 못 덮는다 — 반대 설정으로 직접 다시 센다.
  const alternative = pillarsAt({
    wallClock: birthClock,
    options: usesSolarTime
      ? HISTORICAL_CLOCK_ONLY
      : { longitude: DEFAULT_LONGITUDE },
  });
  const solarTimeChanges = differingPillars({
    base: found,
    other: alternative,
  });
  if (solarTimeChanges.length > 0) {
    if (usesSolarTime) {
      warnings.push(`진태양시 보정을 끄면 ${solarTimeChanges}(으)로 바뀝니다.`);
    } else {
      warnings.push(
        `진태양시 보정(--solar-time, 경도 ${DEFAULT_LONGITUDE} 기준)을 켜면 ${solarTimeChanges}(으)로 바뀝니다.`,
      );
    }
  }
  const allBoundaries: DayBoundary[] = ['midnight', 'jasi', 'splitJasi'];
  const dependsOnDayBoundary = allBoundaries.some((boundary) => {
    const other = pillarsAt({
      wallClock: birthClock,
      options: trueSolarTime,
      boundary,
    });
    const hasDifference = differingPillars({ base: found, other }).length > 0;
    return hasDifference;
  });
  if (dependsOnDayBoundary) {
    warnings.push(
      '밤 11시대 출생이라 자시를 어느 날로 보느냐(--day-boundary)에 따라 일주·시주가 바뀝니다.',
    );
  }
  return { pillars, warnings };
};

const PILLAR_NAMES = ['년주', '월주', '일주', '시주'];

const pillarFields = ({
  year,
  month,
  day,
  hour,
}: FourPillarsDetail): Pillar[] => [year, month, day, hour];

const toHanja = ({ heavenlyStem, earthlyBranch }: Pillar): string =>
  pillarFromHangul({ stem: heavenlyStem, branch: earthlyBranch });

// 다른 기둥만 "일주 辛丑·시주 戊子" 처럼 잇는다. 없으면 빈 문자열.
const differingPillars = ({
  base,
  other,
}: {
  base: FourPillarsDetail;
  other: FourPillarsDetail;
}): string => {
  const otherFields = pillarFields(other);
  const changes = pillarFields(base)
    .map((pillar, index) => ({
      name: PILLAR_NAMES[index],
      before: toHanja(pillar),
      after: toHanja(otherFields[index]),
    }))
    .filter(({ before, after }) => before !== after)
    .map(({ name, after }) => `${name} ${after}`);
  const joined = changes.join('·');
  return joined;
};
