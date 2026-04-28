export interface PrReviewOutcome {
  id: number;
  agentRunId: number;
  slackUserId: string;
  accepted: boolean;
  comment: string | null;
  createdAt: Date;
}

export interface SaveReviewOutcomeInput {
  agentRunId: number;
  slackUserId: string;
  accepted: boolean;
  comment?: string;
}
