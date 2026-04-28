// V3 BE-3 Schema Architect (lite). 자연어 요청 + 현재 prisma/schema.prisma → 변경 제안.
// AST/Code Graph 없는 lite 버전 — LLM 이 schema 텍스트 + 요청만 보고 제안. 실제 영향도 분석은 follow-up.

export interface GenerateSchemaProposalInput {
  request: string;
  slackUserId: string;
}

// LLM 출력 — Slack 응답 + agent_run.output 에 저장.
export interface SchemaProposal {
  // 사용자 요청을 한 줄로 echo (formatter 가 헤더로 사용).
  request: string;
  // 새/변경된 model 정의 (Prisma DSL fragment, 단일 문자열 — 사용자가 schema.prisma 에 그대로 paste 가능).
  proposedModel: string;
  // 영향 받는 기존 모델 / 관계 — LLM 이 schema 본문을 보고 식별.
  affectedRelations: string[];
  // 추가가 필요한 인덱스/유니크 제약 (NotionTask.lastEditedTime 같은 운영용 인덱스).
  requiredIndexes: string[];
  // db push 적용 전 검증할 컨벤션 항목 (snake_case 매핑, FK onDelete 정책 등).
  conventionChecks: string[];
  // 도입에 따른 리스크/엣지 케이스 (대량 backfill, 동시성, 마이그레이션 시 lock 등).
  risks: string[];
  // 도입 단계 권고 (db push → backfill → consumer 추가 / 단순 add-only 등).
  migrationStrategy: string;
  // 종합 reasoning — 왜 이렇게 제안했는지 2~4 문장.
  reasoning: string;
}
