export interface SaveReviewOutcomeInput {
  agentRunId: number;
  slackUserId: string;
  accepted: boolean;
  comment?: string;
}
