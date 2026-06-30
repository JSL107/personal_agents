// docs-sync-audit 포트 — 문서↔코드 동기화 점검 결과. autopilot task 가 소비.

// Layer 1: 결정론 게이트 (docs:check / check:env).
export interface DeterministicDriftReport {
  // drift 가 있으면 false. 깨끗하면 true.
  inSync: boolean;
  // 드리프트 명령별 사람이 읽는 사유 (예: "docs:check FAIL — docs/agent-catalog.md").
  details: string[];
}

// Layer 2 — 한 건의 문서 편집(정확·유일 매칭 search/replace).
export interface DocEdit {
  // 대상 문서에서 정확히 1회 매칭돼야 하는 원본 문자열(개행 포함 가능).
  oldString: string;
  // 치환 문자열.
  newString: string;
}

// Layer 2: optimizer 단일 산출.
export interface OptimizerOutput {
  // 수정 필요 없음이면 false (이 파일은 코드와 일치).
  needsRevision: boolean;
  filePath: string; // 대상 문서(targetDoc) 경로
  edits: DocEdit[];
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
  filePath: string; // 대상 문서 경로
  edits: DocEdit[];
  rationale: string;
  score: number;
  // green 종료(true) vs 반복캡/Circuit Breaker 로 미확정 종료(false).
  confirmed: boolean;
}

// Layer 2 적용 산출 — DocsRevisionApplier 가 채우고 task→preview payload 로 흐른다.
// (순환 import 회피 위해 domain port 에 정의 — applier 가 여기서 import.)
export interface DocsRevision {
  files: { path: string; content: string }[];
  changedFiles: string[];
  previewText: string;
}

// DocsAuditResult 에 revision 추가(확정 제안의 적용 결과 — 없으면 null).
export interface DocsAuditResult {
  deterministic: DeterministicDriftReport;
  proposals: DocsRevisionProposal[];
  revision: DocsRevision | null;
}

export interface DocsAuditPort {
  runAudit(): Promise<DocsAuditResult>;
}

export const DOCS_AUDIT_PORT = Symbol('DOCS_AUDIT_PORT');
