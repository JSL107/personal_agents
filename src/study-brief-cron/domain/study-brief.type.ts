export interface StudyBriefConceptVerdict {
  kind: 'CONCEPT';
  whyNow: string;
  whereItLands: string;
  minutes: number;
}

export interface StudyBriefToolVerdict {
  kind: 'TOOL';
  whatImproves: string;
  adoptionCost: string;
  caution?: string;
  minutes: number;
}

export type StudyBriefVerdict =
  | StudyBriefConceptVerdict
  | StudyBriefToolVerdict;
