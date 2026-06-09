import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ConversationContext } from '../../../router/domain/conversation-context.type';

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
  // 자연어 진입 시 router 가 전달하는 대화 맥락 — userInstruction(직전 대화 기반 사용자 지시)을
  // prompt [사용자 지시] 섹션으로 반영. 슬래시 /review-pr 진입은 미주입 (기존 동작).
  conversationContext?: ConversationContext;
}
