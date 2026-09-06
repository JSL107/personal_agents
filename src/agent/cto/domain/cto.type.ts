// CTO 의 스터디 주제 평가 — 개념/도구 두 갈래 판정과 그 입력.
export interface StudyConceptVerdict {
  kind: 'CONCEPT';
  whyNow: string;
  whereItLands: string;
  minutes: number;
}

export interface StudyToolVerdict {
  kind: 'TOOL';
  whatImproves: string;
  adoptionCost: string;
  caution?: string;
  minutes: number;
}

export type StudyTopicVerdict = StudyConceptVerdict | StudyToolVerdict;

export type StudyTopicKind = 'CONCEPT' | 'TOOL';

export interface StudyTopicResearch {
  kind: StudyTopicKind;
  topic: string;
  reportMd: string;
  sourceUrls: readonly string[];
}

export interface RepoModuleSummary {
  name: string;
  description: string;
}

export interface EvaluateStudyTopicInput {
  slackUserId: string;
  research: StudyTopicResearch;
  profileSummary?: string;
  profileSkills?: readonly string[];
  repoModules?: readonly RepoModuleSummary[];
}
