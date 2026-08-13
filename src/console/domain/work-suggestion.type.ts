import { AgentType } from '../../model-router/domain/model-router.type';

export interface WorkSuggestion {
  readonly agentType: AgentType;
  readonly displayName: string;
  /** 사람이 읽는 근거. 예: '마지막 성공 3일 전 · 평소 1일 주기' */
  readonly reason: string;
}

export interface WorkSuggestionResult {
  readonly suggestions: readonly WorkSuggestion[];
  /** 성공한 KST 날짜가 2개 미만이라 주기를 알 수 없어 후보에서 빠진 worker 수. */
  readonly skippedUnknownCycle: number;
  /** due 후보 중 상위 목록 제한 때문에 suggestions에서 빠진 worker 수. */
  readonly alsoDueCount: number;
}
