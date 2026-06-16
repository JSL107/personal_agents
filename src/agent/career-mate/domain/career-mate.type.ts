export type SkillCategory = 'LANGUAGE' | 'FRAMEWORK' | 'DOMAIN' | 'TOOL';
export type Proficiency = 'FAMILIAR' | 'PROFICIENT' | 'EXPERT';

export interface SkillEvidence {
  repo: string;
  pr: number;
  url: string;
}

export interface ProfileSkill {
  name: string;
  category: SkillCategory;
  proficiency: Proficiency;
  evidence: SkillEvidence[];
}

export interface AccomplishmentEvidence extends SkillEvidence {
  mergedAt: string;
}

export interface ProfileAccomplishment {
  title: string;
  bullet: string;
  star: { situation: string; task: string; action: string; result: string };
  techTags: string[];
  evidence: AccomplishmentEvidence[];
}

export interface CareerProfileData {
  summary: string;
  skills: ProfileSkill[];
  accomplishments: ProfileAccomplishment[];
  meta: { githubLogin: string; windowStart: string; prCount: number };
}

export type CareerMateAction =
  | 'BUILD_PROFILE'
  | 'RENDER_RESUME'
  | 'RENDER_PORTFOLIO'
  | 'ANALYZE_JD_GAP'
  | 'CALIBRATE_RESUME'
  | 'UNKNOWN';

export interface CareerMateIntent {
  action: CareerMateAction;
  windowMonths?: number;
}

export interface GapTopic {
  title: string;
  rationale: string;
}

export interface GapAnalysisData {
  fitSummary: string;
  have: string[];
  gaps: string[];
  topics: GapTopic[];
}

export interface AnalyzeJdGapInput {
  slackUserId: string;
  jdText: string;
}

export interface BuildCareerProfileInput {
  slackUserId: string;
  windowMonths?: number;
}

export interface RenderResumeInput {
  slackUserId: string;
}

export interface RenderResumeResult {
  profile: CareerProfileData;
  agentRunId: number;
}

export interface RenderPortfolioInput {
  slackUserId: string;
}

export interface RenderPortfolioResult {
  url: string;
  pageId: string;
  agentRunId: number;
}

export interface CalibrationResultData {
  verdict: string;
  aiSlopRisks: string[];
  underQuantified: string[];
  outdatedPhrasing: string[];
  missingKeywords: string[];
  actionItems: string[];
}

export interface CalibrateResumeInput {
  slackUserId: string;
  webTrendsNote?: string;
}
