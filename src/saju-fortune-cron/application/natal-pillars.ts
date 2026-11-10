import {
  BirthInfo,
  calculateFourPillars,
  DayBoundary,
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
// 시각을 모를 때 쓰는 대표 시각. 일주는 자정 기준이라 영향이 없고, 년·월주는 절입일만 따로 경고한다.
const UNKNOWN_TIME: BirthTime = { hour: 12, minute: 0 };
// 시진 경계 경고 폭 — 진태양시 보정(서울 약 −32분)을 켜고 끄는 차이를 덮는다.
const HOUR_BOUNDARY_MARGIN_MINUTES = 30;
const MILLISECONDS_PER_MINUTE = 60_000;

export const natalPillarsOf = (input: NatalBirthInput): NatalPillarsResult => {
  // 음력은 먼저 양력으로 바꾼다 — 경계 경고에서 분 단위로 시각을 밀 때 날짜 연산을 양력으로만 하기 위해서다.
  const solarDate = input.isLunar
    ? lunarToSolar(
        input.year,
        input.month,
        input.day,
        input.isLeapMonth ?? false,
      )
    : { year: input.year, month: input.month, day: input.day };
  const trueSolarTime =
    input.solarTimeLongitude === undefined
      ? HISTORICAL_CLOCK_ONLY
      : { longitude: input.solarTimeLongitude };
  const dayBoundary = input.dayBoundary ?? 'midnight';
  const pillarsAt = (
    wallClock: WallClock,
    boundary: DayBoundary = dayBoundary,
  ): FourPillarsDetail =>
    calculateFourPillars({
      ...wallClock,
      trueSolarTime,
      dayBoundary: boundary,
    } satisfies BirthInfo);

  const { time } = input;
  const found = pillarsAt({ ...solarDate, ...(time ?? UNKNOWN_TIME) });
  const pillars = [found.year, found.month, found.day].map(toHanja);
  const warnings: string[] = [];

  if (!time) {
    const dayStart = pillarsAt({ ...solarDate, hour: 0, minute: 0 });
    const dayEnd = pillarsAt({ ...solarDate, hour: 23, minute: 59 });
    if (
      toHanja(dayStart.year) !== toHanja(dayEnd.year) ||
      toHanja(dayStart.month) !== toHanja(dayEnd.month)
    ) {
      warnings.push(
        '절입일(입춘·절기 당일) 출생이라 시각에 따라 년주·월주가 바뀝니다. 시각을 알아야 정확합니다.',
      );
    }
    return { pillars, warnings };
  }

  pillars.push(toHanja(found.hour));
  const birthClock: WallClock = { ...solarDate, ...time };
  const shiftedHours = [-1, 1].map((sign) =>
    toHanja(
      pillarsAt(shiftMinutes(birthClock, sign * HOUR_BOUNDARY_MARGIN_MINUTES))
        .hour,
    ),
  );
  if (shiftedHours.some((hourPillar) => hourPillar !== pillars[3])) {
    warnings.push(
      `시진 경계 ±${HOUR_BOUNDARY_MARGIN_MINUTES}분 안이라 진태양시 보정 여부에 따라 시주가 바뀔 수 있습니다.`,
    );
  }
  const allBoundaries: DayBoundary[] = ['midnight', 'jasi', 'splitJasi'];
  if (
    allBoundaries.some((boundary) => {
      const other = pillarsAt(birthClock, boundary);
      return (
        toHanja(other.day) !== pillars[2] || toHanja(other.hour) !== pillars[3]
      );
    })
  ) {
    warnings.push(
      '밤 11시대 출생이라 자시를 어느 날로 보느냐(--day-boundary)에 따라 일주·시주가 바뀝니다.',
    );
  }
  return { pillars, warnings };
};

const toHanja = (pillar: Pillar): string =>
  pillarFromHangul(pillar.heavenlyStem, pillar.earthlyBranch);

// 경계 경고 전용 — 날짜를 넘겨 밀어도 되도록 UTC 산술로 벽시계 값을 다시 만든다.
const shiftMinutes = (wallClock: WallClock, minutes: number): WallClock => {
  const { year, month, day, hour, minute } = wallClock;
  const shifted = new Date(
    Date.UTC(year, month - 1, day, hour, minute) +
      minutes * MILLISECONDS_PER_MINUTE,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
};
