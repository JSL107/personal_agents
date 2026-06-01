import { TriggerType } from '../../../agent-run/domain/agent-run.type';

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
  // 자동 트리거 (예: GitHub webhook pull_request.opened) 와 사용자 트리거를 구분하기 위한 옵션.
  // 미지정 시 SLACK_COMMAND_REVIEW_PR 로 기록.
  triggerType?: TriggerType;
}
