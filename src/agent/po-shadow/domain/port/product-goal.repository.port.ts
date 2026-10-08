import { GoalDeclarationProblem, ProductGoalRecord } from '../product-goal';

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

// 저장 직전 활성 목록을 보고 거절 사유를 돌려주는 검사. 저장소가 같은 트랜잭션 안에서 부른다.
export type ActiveGoalGuard = (
  activeGoals: ProductGoalRecord[],
) => GoalDeclarationProblem | null;

export type CreateProductGoalResult =
  | { created: ProductGoalRecord }
  | { problem: GoalDeclarationProblem; activeGoals: ProductGoalRecord[] };

export interface ProductGoalRepositoryPort {
  // 활성(closedAt IS NULL) 목표만. 만든 순서대로.
  findActive(slackUserId: string): Promise<ProductGoalRecord[]>;
  // 활성 목록 조회·검사·저장을 직렬화 격리 트랜잭션 하나로 묶는다. 확인 카드 두 장이 동시에
  // 승인돼도 둘 다 같은 개수를 읽고 상한을 넘기지 않는다 — 겹친 쪽은 직렬화 실패로 끝난다.
  createGuarded(
    input: CreateProductGoalInput,
    guard: ActiveGoalGuard,
  ): Promise<CreateProductGoalResult>;
  // 이미 닫혔거나 남의 목표면 false — 두 번 눌린 카드가 닫힌 시각을 덮어쓰지 않는다.
  close(input: CloseProductGoalInput): Promise<boolean>;
}
