import { ProductGoalDraft } from '../product-goal';

export const GOAL_QUESTION_REPOSITORY_PORT = Symbol(
  'GOAL_QUESTION_REPOSITORY_PORT',
);

export const GOAL_QUESTION_TTL_MS = 72 * 60 * 60 * 1000;

export type GoalQuestionCloseReason =
  | 'DECLINED'
  | 'CARD_RESOLVED'
  | 'LIMIT_REACHED';

export interface GoalQuestionRecord {
  id: number;
  slackUserId: string;
  expiresAt: Date;
  previewId: string | null;
  criterionAskedAt: Date | null;
  pendingDraft: unknown;
  closedAt: Date | null;
  closeReason: string | null;
  createdAt: Date;
}

export interface CreateGoalQuestionInput {
  slackUserId: string;
  expiresAt: Date;
}

export interface FindOpenGoalQuestionInput {
  slackUserId: string;
  now: Date;
}

export interface AttachGoalQuestionPreviewInput {
  id: number;
  previewId: string;
}

export interface MarkGoalQuestionCriterionAskedInput {
  id: number;
  at: Date;
  pendingDraft: ProductGoalDraft;
}

export interface CloseGoalQuestionInput {
  id: number;
  reason: GoalQuestionCloseReason;
  at: Date;
}

export interface GoalQuestionRepositoryPort {
  create(input: CreateGoalQuestionInput): Promise<GoalQuestionRecord>;
  findOpen(
    input: FindOpenGoalQuestionInput,
  ): Promise<GoalQuestionRecord | null>;
  attachPreview(input: AttachGoalQuestionPreviewInput): Promise<void>;
  markCriterionAsked(input: MarkGoalQuestionCriterionAskedInput): Promise<void>;
  close(input: CloseGoalQuestionInput): Promise<void>;
}
