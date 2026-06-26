// Knowledge-Lint 포트 — episodic-memory 무결성 점검 결과.
// EpisodicMemoryPort(record/searchRelevant)와 분리한다: 소비자(autopilot)가 다르고,
// "소비자가 의존하는 좁은 인터페이스"인 기존 포트를 오염시키지 않기 위함(ISP).

export type KnowledgeLintIssueType = 'near_duplicate' | 'embedding_null';

export interface KnowledgeLintIssue {
  type: KnowledgeLintIssueType;
  episodeId: number;
  relatedId?: number; // near_duplicate 짝 에피소드 id.
  detail: string; // 사람이 읽는 사유(예: "중복 후보 — distance 0.012").
  occurredAt: Date;
}

export interface LintEpisodicMemoryInput {
  // near-duplicate 판정 임계값(cosine distance). 이보다 가까운 쌍을 중복 후보로 본다.
  duplicateMaxDistance: number;
  // 이슈 종류별 최대 보고 개수(Slack digest 폭주 방지).
  limit: number;
}

export interface KnowledgeLintPort {
  lintIssues(input: LintEpisodicMemoryInput): Promise<KnowledgeLintIssue[]>;
}

export const KNOWLEDGE_LINT_PORT = Symbol('KNOWLEDGE_LINT_PORT');
