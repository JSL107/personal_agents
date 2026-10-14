export type IdeaVerdict = 'BUILD' | 'REVISE_THEN_BUILD' | 'DROP';
export type IdeaEffort = 'S' | 'M' | 'L';
export type IdeaTriageStatus = 'JUDGED' | 'POSTED' | 'SCHEDULED';

export const EFFORT_BUSINESS_DAYS: Record<IdeaEffort, number> = {
  S: 1,
  M: 3,
  L: 5,
};

export interface IdeaJudgement {
  verdict: IdeaVerdict;
  reason: string;
  counterpoint: string;
  scheduleTitle: string;
  effort: IdeaEffort;
}
