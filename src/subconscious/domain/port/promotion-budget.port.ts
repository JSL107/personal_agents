export const PROMOTION_BUDGET = Symbol('PROMOTION_BUDGET');

export interface PromotionBudget {
  // now = epoch ms (주입으로 결정론적 테스트). 예산 여유 있으면 1건 소비 후 true.
  tryConsume(ownerSlackUserId: string, now: number): Promise<boolean>;
}
