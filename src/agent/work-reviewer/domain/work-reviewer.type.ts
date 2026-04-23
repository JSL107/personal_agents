export interface DailyReviewImpact {
  quantitative: string[];
  qualitative: string;
}

export interface ImprovementBeforeAfter {
  before: string;
  after: string;
}

export interface DailyReview {
  summary: string;
  impact: DailyReviewImpact;
  improvementBeforeAfter: ImprovementBeforeAfter | null;
  nextActions: string[];
  oneLineAchievement: string;
}

export interface GenerateWorklogInput {
  workText: string;
  slackUserId: string;
}
