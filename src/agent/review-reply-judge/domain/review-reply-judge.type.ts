export type ReplyVerdict = 'ACCEPTED' | 'REJECTED' | 'UNCLEAR';

export interface ReviewReplyJudgeItem {
  id: number;
  body: string;
  replyBody: string;
}

export interface JudgeReviewReplyInput {
  items: ReviewReplyJudgeItem[];
}

export interface ReviewReplyJudgment {
  id: number;
  verdict: ReplyVerdict;
  reason: string;
}
