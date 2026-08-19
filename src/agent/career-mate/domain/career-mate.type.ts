import { TriggerType } from '../../../agent-run/domain/agent-run.type';

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
  mergedAt: string | null;
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

export type AuditStatus = 'PROVEN' | 'WEAK' | 'MISSING' | 'UNJUDGED';
export type RewriteFrame = 'STAR3' | 'STAR4';

export interface AuditRewrite {
  before: string;
  after: string;
  frame: RewriteFrame;
}

export interface AuditItem {
  title: string;
  status: AuditStatus;
  quote: string;
  why: string;
  rewrite: AuditRewrite | null;
}

export type JdPriority = 'MUST' | 'PREFERRED' | 'IMPLICIT';

export interface JdFinding {
  requirement: string;
  priority: JdPriority;
  status: AuditStatus;
  quote: string;
  why: string;
}

export interface RejectionRisk {
  reason: string;
  rebuttal: string | null;
}

// 이력서 상단에 먼저 배치할 성과. 배열 순서가 곧 배치 순서라 rank 필드를 따로 두지 않는다 —
// 숫자를 받으면 모델이 1,1,2 같이 중복을 내는 회차를 검증으로 걸러야 한다.
export interface AuditHighlight {
  title: string;
  reason: string;
}

export interface ResumeAuditData {
  verdict: string;
  items: AuditItem[];
  highlights: AuditHighlight[];
  jdFindings: JdFinding[];
  rejectionRisks: RejectionRisk[];
}

export interface ResumeAuditResult extends ResumeAuditData {
  guard: {
    demotedTitles: string[];
    droppedTitles: string[];
    unjudgedTitles: string[];
    forcedMissing: string[];
    // WEAK/MISSING 인데 모델이 rewrite 를 주지 않은 성과. 파싱을 거부하지 않고 여기서 드러낸다.
    rewriteMissing: string[];
    // 입증되지 않은(또는 존재하지 않는) 성과를 앞세우려 해서 버린 highlight. 강등이 겹치면
    // highlights 가 통째로 비는데, 사유를 남기지 않으면 "앞세울 게 없다" 와 구분되지 않는다.
    droppedHighlights: string[];
  };
  jdSource: {
    company: string;
    role: string;
    registeredAt: string;
  } | null;
}

export interface AuditResumeInput {
  slackUserId: string;
  triggerType: TriggerType;
}

export interface CareerTargetJdData {
  id: number;
  company: string;
  role: string;
  jdText: string;
  createdAt: Date;
}

export type CareerMateAction =
  | 'BUILD_PROFILE'
  | 'RENDER_RESUME'
  | 'RENDER_PORTFOLIO'
  | 'ANALYZE_JD_GAP'
  | 'CALIBRATE_RESUME'
  | 'AUDIT_RESUME'
  | 'REFLECT_PR'
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

// REFLECT_PR — 단일 PR 회고 → 이력서/포트폴리오 반영.
export interface ParsedPrRef {
  repo: string; // "owner/repo"
  number: number;
}

export interface ReflectPrInput {
  slackUserId: string;
  prText: string; // 사용자 원문 (dispatcher 가 input.text 를 그대로 전달)
}

export interface PrRetroSynth {
  accomplishment: ProfileAccomplishment;
  narrative: string;
}

export interface ReflectPrResult {
  accomplishment: ProfileAccomplishment;
  narrative: string;
  portfolioUrl: string;
  agentRunId: number;
  modelUsed: string;
}
