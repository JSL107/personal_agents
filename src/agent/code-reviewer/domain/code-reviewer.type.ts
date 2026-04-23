export type RiskLevel = 'low' | 'medium' | 'high';

export type ApprovalRecommendation = 'approve' | 'request_changes' | 'comment';

export interface ReviewCommentDraft {
  file?: string;
  line?: number;
  body: string;
}

export interface PullRequestReview {
  summary: string;
  riskLevel: RiskLevel;
  mustFix: string[];
  niceToHave: string[];
  missingTests: string[];
  reviewCommentDrafts: ReviewCommentDraft[];
  approvalRecommendation: ApprovalRecommendation;
}

export interface ReviewPullRequestInput {
  prRef: string; // URL 또는 "owner/repo#number"
  slackUserId: string;
}
