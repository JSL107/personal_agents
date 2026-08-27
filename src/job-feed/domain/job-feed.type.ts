export type JobSourceId = 'jumpit' | 'rallit' | 'wanted';
export type ExperienceLevel =
  | 'newcomer'
  | 'junior'
  | 'mid'
  | 'senior'
  | 'any';
export type YearsSource = 'RANGE' | 'LEVEL';
export type SourceStatus = 'SUCCESS' | 'DEGRADED' | 'FAILED';

// 소스 매퍼가 목록 응답 한 건에서 뽑아내는 값. 정규화 전이다.
export interface RawJobPosting {
  source: JobSourceId;
  sourceId: string;
  company: string;
  title: string;
  detailUrl: string;
  rawSkillTags: string[];
  minYears: number | null;
  maxYears: number | null;
  yearsSource: YearsSource;
  rawJobLevel: string | null;
  isNewcomer: boolean;
  rawLocations: string[];
}

// 상세 응답에서 뽑아내는 값. 원티드처럼 목록에 스킬이 없는 소스는 skillTags 도 여기서 온다.
export interface RawJobDetail {
  jdText: string;
  rawSkillTags: string[];
}

export interface NormalizedJobPosting {
  source: JobSourceId;
  sourceId: string;
  company: string;
  companyKey: string;
  title: string;
  detailUrl: string;
  skillTags: string[];
  rawSkillTags: string[];
  minYears: number | null;
  maxYears: number | null;
  yearsSource: YearsSource;
  rawJobLevel: string | null;
  experienceLevel: ExperienceLevel;
  locations: string[];
  rawLocations: string[];
  normalizedKey: string;
  contentHash: string;
}

// 소스별 3단 계수. 조용한 실패를 드러내는 유일한 신호다.
export interface SourceFetchOutcome {
  source: JobSourceId;
  status: SourceStatus;
  received: number;
  validated: number;
  accepted: number;
  httpStatus: number | null;
  error: string | null;
}
