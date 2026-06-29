// docs-sync-audit 포트 — 문서↔코드 동기화 점검 결과. autopilot task 가 소비.

// Layer 1: 결정론 게이트 (docs:check / check:env).
export interface DeterministicDriftReport {
  // drift 가 있으면 false. 깨끗하면 true.
  inSync: boolean;
  // 드리프트 명령별 사람이 읽는 사유 (예: "docs:check FAIL — docs/agent-catalog.md").
  details: string[];
}

// Layer 2: optimizer 단일 산출.
export interface OptimizerOutput {
  // 수정 필요 없음이면 false (이 파일은 코드와 일치).
  needsRevision: boolean;
  filePath: string;
  // 제안 수정 설명 + 발췌 diff (적용은 Phase 2 — 여기선 텍스트).
  proposedDiff: string;
  rationale: string;
}

// Layer 2: evaluator 채점.
export interface EvaluatorVerdict {
  pass: boolean;
  score: number; // 0-100
  feedback: string;
}

// Layer 2: 루프가 확정한 검증된 제안.
export interface DocsRevisionProposal {
  filePath: string;
  proposedDiff: string;
  rationale: string;
  score: number;
  // green 종료(true) vs 반복캡/Circuit Breaker 로 미확정 종료(false).
  confirmed: boolean;
}

export interface DocsAuditResult {
  deterministic: DeterministicDriftReport;
  proposals: DocsRevisionProposal[];
}

export interface DocsAuditPort {
  runAudit(): Promise<DocsAuditResult>;
}

export const DOCS_AUDIT_PORT = Symbol('DOCS_AUDIT_PORT');
