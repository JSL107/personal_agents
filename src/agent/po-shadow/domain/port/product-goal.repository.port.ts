import { ProductGoalRecord } from '../product-goal';

export const PRODUCT_GOAL_REPOSITORY_PORT = Symbol(
  'PRODUCT_GOAL_REPOSITORY_PORT',
);

export interface CreateProductGoalInput {
  slackUserId: string;
  title: string;
  successCriterion: string;
  keywords: string[];
  dueDate: Date | null;
}

export interface CloseProductGoalInput {
  id: number;
  slackUserId: string;
  closedAt: Date;
}

export interface ProductGoalRepositoryPort {
  // 활성(closedAt IS NULL) 목표만. 만든 순서대로.
  findActive(slackUserId: string): Promise<ProductGoalRecord[]>;
  create(input: CreateProductGoalInput): Promise<ProductGoalRecord>;
  // 이미 닫혔거나 남의 목표면 false — 두 번 눌린 카드가 닫힌 시각을 덮어쓰지 않는다.
  close(input: CloseProductGoalInput): Promise<boolean>;
}
