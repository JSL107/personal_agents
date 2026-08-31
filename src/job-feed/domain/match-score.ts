import { NormalizedJobPosting } from './job-feed.type';
import {
  FRONTEND_ONLY_SKILL_KEYS,
  normalizeSkillTags,
  toSkillKey,
} from './skill-dictionary';

export type YearsFit = 'FIT' | 'OVER' | 'UNDER' | 'NEUTRAL';

export interface MatchProfile {
  skillTags: string[];
  years: number | null;
  locations: string[];
}

export interface MatchBreakdown {
  score: number;
  skillHitRatio: number;
  matchedSkills: string[];
  missingSkills: string[];
  yearsFit: YearsFit;
  locationFit: boolean;
}

export interface BuildMatchProfileInput {
  techTags: string[];
  years: number | null;
  locations: string[];
}

// 프로필 기술도 공고와 같은 사전을 통과시킨다. 한쪽만 다듬으면 사전이 절반만 작동한다.
//
// 다만 프론트·모바일 전용 기술은 여기서만 뺀다. 이 피드는 백엔드 공고를 고르는 것이
// 목적인데, 곁다리로 익힌 React·Next.js 가 매칭에 쓰이면 프론트 공고가 만점으로
// 올라온다(실측: 'Backend Engineer' 제목에 React·TypeScript·Next.js 만 적힌 공고가
// 3/3 = 100점). 공고 쪽에서 빼면 안 되는 이유는 FRONTEND_ONLY_SKILL_KEYS 주석 참조.
export const buildMatchProfile = ({
  techTags,
  years,
  locations,
}: BuildMatchProfileInput): MatchProfile => {
  return {
    skillTags: normalizeSkillTags(techTags).identified.filter((tag) => {
      return !FRONTEND_ONLY_SKILL_KEYS.has(toSkillKey(tag));
    }),
    years,
    locations,
  };
};

// 스킬 축(70점)을 비율과 증거량으로 쪼갠다. 비율만 보면 요구 기술이 하나뿐인
// 공고(1/1)와 다섯 개를 모두 맞춘 공고(5/5)가 똑같이 만점을 받는다 — 실측
// (2026-08-31) 당시 만점 35건 중 태그가 한두 개뿐인 행이 15건(43%)이었고,
// 알림은 점수 내림차순 상위 10건이라 카드가 매일 만점 동점으로만 채워졌다.
const SKILL_RATIO_WEIGHT = 50;
const SKILL_DEPTH_WEIGHT = 20;
const YEARS_WEIGHT = 20;
const LOCATION_WEIGHT = 10;

// 몇 개를 맞혀야 증거 축이 만점인가. 같은 실측에서 만점 공고의 40%가 태그 4개
// 이상이었다 — 그 위는 만점으로 묶고 아래를 개수 순으로 가른다. 더 올리면
// 태그를 적게 다는 소스(점핏)가 구조적으로 불리해진다.
const SKILL_DEPTH_SATURATION = 4;

const resolveYearsFit = (
  posting: NormalizedJobPosting,
  years: number | null,
): YearsFit => {
  // 설정을 안 한 것과 조건에 안 맞는 것은 다르다. 축을 빼고 매긴다.
  if (years === null) {
    return 'NEUTRAL';
  }
  if (posting.minYears === null && posting.maxYears === null) {
    return 'NEUTRAL';
  }
  if (posting.minYears !== null && years < posting.minYears) {
    return 'UNDER';
  }
  if (posting.maxYears !== null && years > posting.maxYears) {
    return 'OVER';
  }
  return 'FIT';
};

const YEARS_RATIO_BY_FIT: Readonly<Record<YearsFit, number>> = {
  FIT: 1,
  NEUTRAL: 1,
  OVER: 0.5,
  UNDER: 0.2,
};

export const scorePosting = (
  posting: NormalizedJobPosting,
  profile: MatchProfile,
): MatchBreakdown => {
  // 키로 비교한다. 사전에 없는 기술은 원본 표기 그대로 담기므로(skill-dictionary.ts),
  // 공고의 'react' 와 프로필의 'React' 가 표기 차이만으로 못 만나면 안 된다.
  const profileSkillKeys = new Set(profile.skillTags.map(toSkillKey));
  const matchedSkills = posting.skillTags.filter((tag) => {
    return profileSkillKeys.has(toSkillKey(tag));
  });
  const missingSkills = posting.skillTags.filter((tag) => {
    return !profileSkillKeys.has(toSkillKey(tag));
  });
  const skillHitRatio =
    posting.skillTags.length === 0
      ? 0
      : matchedSkills.length / posting.skillTags.length;
  // 공고가 태그를 안 주면 판단 근거가 없다. 0점으로 떨어뜨리지 않고 중립값을 쓴다.
  const skillRatioForScore =
    posting.skillTags.length === 0 ? 0.5 : skillHitRatio;

  const yearsFit = resolveYearsFit(posting, profile.years);

  const locationFit =
    profile.locations.length === 0 ||
    posting.locations.length === 0 ||
    posting.locations.some((location) => {
      return profile.locations.includes(location);
    });

  // 맞힌 개수 자체가 증거다. 비율 축과 달리 공고가 요구한 개수로 나누지 않는다 —
  // 나누면 다시 1/1 과 5/5 가 같아진다.
  const skillDepthRatio =
    Math.min(matchedSkills.length, SKILL_DEPTH_SATURATION) /
    SKILL_DEPTH_SATURATION;

  const score = Math.round(
    SKILL_RATIO_WEIGHT * skillRatioForScore +
      SKILL_DEPTH_WEIGHT * skillDepthRatio +
      YEARS_WEIGHT * YEARS_RATIO_BY_FIT[yearsFit] +
      LOCATION_WEIGHT * (locationFit ? 1 : 0),
  );

  return {
    score,
    skillHitRatio,
    matchedSkills,
    missingSkills,
    yearsFit,
    locationFit,
  };
};
