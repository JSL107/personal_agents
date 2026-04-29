// V3 BE-3 Schema Architect (lite). 자연어 요청 + 현재 prisma/schema.prisma → 변경 제안.
// AST/Code Graph 없는 lite 버전 — LLM 이 schema 텍스트 + 요청만 보고 제안. 실제 영향도 분석은 follow-up.

import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface GenerateSchemaProposalInput {
  request: string;
  slackUserId: string;
  // /retry-run 같이 명시 trigger 가 필요할 때 외부에서 주입. 미지정 시 SLACK_COMMAND_BE_SCHEMA.
  triggerType?: TriggerType;
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
  // V3 SOTA Foundation 1.1 단계 5 — Code Graph query 결과 (서버 주입, LLM 응답에서 가져오지 않음).
  // `@prisma/client` 를 import 하는 파일 list — 이 schema 변경이 영향 미칠 수 있는 surface.
  // build 실패 또는 빈 결과면 빈 배열 ([]). LLM prompt 컨텍스트로도 주입돼 영향도 분석에 활용.
  affectedFiles: string[];
}
