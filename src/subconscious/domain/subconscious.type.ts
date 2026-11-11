import { AgentType } from '../../model-router/domain/model-router.type';

/**
 * 제안 카드가 실행을 맡길 수 있는 워커 — 게이트 후보, 카드 생성, ✅실행이 모두 이 목록을 본다.
 *
 * PR 리뷰만 남긴다. PM·WORK_REVIEWER 는 2026-11-11 에 뺐다: Notion 버그 티켓 제안이 대부분 이
 * 둘로 배정돼, 실행하면 조사 대신 오늘 Notion 체크인·회고가 써졌고, 결과 run 이 다음 날 계획의
 * "직전 계획"·`/sync-plan` 원장에도 섞였다. 14일간 두 워커 카드의 실행은 0건이었다.
 */
export const PROPOSABLE_AGENT_TYPES: ReadonlySet<AgentType> = new Set([
  AgentType.CODE_REVIEWER,
]);

export interface StateItem {
  key: string; // 안정 식별자. 예: 'github:pr:owner/repo#123'
  fingerprint: string; // 내용 해시 — 변하면 'modified'
  summary: string; // redact 전 짧은 사람용 요약
}

export interface StateSnapshot {
  sourceId: string;
  contentHash: string;
  items: StateItem[];
}

export type StateChangeKind = 'added' | 'modified' | 'removed';

export interface StateChange {
  sourceId: string;
  kind: StateChangeKind;
  item: StateItem;
}

export interface RedactedChange {
  sourceId: string;
  kind: StateChangeKind;
  key: string;
  summary: string; // redactPii 적용됨
}

export interface GateDecision {
  changeKey: string;
  promote: boolean;
  reason: string;
  suggestedAgentType?: AgentType;
  proposalText?: string;
}
