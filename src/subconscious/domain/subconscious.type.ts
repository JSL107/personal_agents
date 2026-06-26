import { AgentType } from '../../model-router/domain/model-router.type';

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
