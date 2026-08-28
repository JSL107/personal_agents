import { ExperienceLevel } from './job-feed.type';

export interface YearsRange {
  minYears: number | null;
  maxYears: number | null;
  experienceLevel: ExperienceLevel;
}

// 랠릿은 연차를 숫자로 주지 않고 등급으로만 준다. 실측 분포(100건): IRRELEVANT 51 · MIDDLE 39
// · JUNIOR 7 · SENIOR 2 · BEGINNER 1.
const RANGE_BY_RALLIT_LEVEL: ReadonlyMap<string, YearsRange> = new Map([
  ['BEGINNER', { minYears: 0, maxYears: 1, experienceLevel: 'newcomer' }],
  ['JUNIOR', { minYears: 1, maxYears: 3, experienceLevel: 'junior' }],
  ['MIDDLE', { minYears: 3, maxYears: 7, experienceLevel: 'mid' }],
  ['SENIOR', { minYears: 7, maxYears: null, experienceLevel: 'senior' }],
  ['IRRELEVANT', { minYears: null, maxYears: null, experienceLevel: 'any' }],
]);

const UNKNOWN_RANGE: YearsRange = {
  minYears: null,
  maxYears: null,
  experienceLevel: 'any',
};

export const resolveRallitLevel = (jobLevel: string): YearsRange => {
  return RANGE_BY_RALLIT_LEVEL.get(jobLevel) ?? UNKNOWN_RANGE;
};

// 원티드는 상한 없음을 annual_to=100 으로 표현한다. 그대로 저장하면 "3~100년차 모집" 이 된다.
const WANTED_UNBOUNDED_ANNUAL = 100;

export const normalizeWantedMaxYears = (
  annualTo: number | null,
): number | null => {
  if (annualTo === null) {
    return null;
  }
  if (annualTo >= WANTED_UNBOUNDED_ANNUAL) {
    return null;
  }
  return annualTo;
};

export interface ExperienceLevelInput {
  minYears: number | null;
  maxYears: number | null;
  isNewcomer: boolean;
}

// 숫자 구간을 주는 소스(점핏·원티드)를 등급으로 옮긴다. 위 랠릿 표와 경계를 맞춘다.
// 위에서부터 처음 걸리는 것을 쓴다.
export const resolveExperienceLevel = ({
  minYears,
  maxYears,
  isNewcomer,
}: ExperienceLevelInput): ExperienceLevel => {
  if (isNewcomer) {
    return 'newcomer';
  }
  if (minYears === null && maxYears === null) {
    return 'any';
  }
  const lower = minYears ?? 0;
  if (lower >= 7) {
    return 'senior';
  }
  if (lower >= 3) {
    return 'mid';
  }
  if (lower >= 1) {
    return 'junior';
  }
  if (maxYears !== null && maxYears <= 1) {
    return 'newcomer';
  }
  return 'junior';
};
