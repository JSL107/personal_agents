import { NormalizedJobPosting } from './job-feed.type';
import { normalizeSkillTags, toSkillKey } from './skill-dictionary';

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
export const buildMatchProfile = ({
  techTags,
  years,
  locations,
}: BuildMatchProfileInput): MatchProfile => {
  return {
    skillTags: normalizeSkillTags(techTags).identified,
    years,
    locations,
  };
};

const SKILL_WEIGHT = 70;
const YEARS_WEIGHT = 20;
const LOCATION_WEIGHT = 10;

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

  const score = Math.round(
    SKILL_WEIGHT * skillRatioForScore +
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
