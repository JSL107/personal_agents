import { AgentRunRange } from '../../../common/domain/agent-run-range.type';

// 호환성 alias — 향후 deprecate 예정. 신규 코드는 AgentRunRange 직접 사용 권장.
export type EvaluationRange = AgentRunRange;

export interface EvaluationInput {
  slackUserId: string;
  // 미지정 시 WEEK (review 권장 — 이력서/careerLog 의 자연 단위).
  range?: EvaluationRange;
}

// 합성 input 으로 사용된 sub-agent 들의 run id. 일부 만 있을 수 있음 (graceful policy).
export interface SubAgentRunRefs {
  workReviewerRunId?: number;
  poShadowRunId?: number;
  impactReporterRunId?: number;
}

// PO 통합 facade 의 output.
// careerLog 는 사용자 외부 형식 (Notion 페이지 / 커리어 페이지) 미공유 상태에서 잠정 schema —
// 향후 사용자가 실제 형식 공유 시 정합 조정. schemaVersion 으로 호환 추적.
// (review omc:architect 권장 — 향후 schema 변경 시 Prisma output JSON 의 이전 row 와 구분.)
export interface EvaluationOutput {
  range: EvaluationRange;
  sourceAgentRuns: SubAgentRunRefs;
  qualitative: {
    summary: string; // 전반 한 줄 요약
    blockers: string[];
    wins: string[];
  };
  careerLog: {
    schemaVersion: 1;
    period: string; // 'YYYY-MM-DD' (TODAY) 또는 'YYYY-Wnn' (WEEK)
    achievements: {
      quantitative: string[]; // "PR 3건 머지", "BE-Schema 2건 적용"
      qualitative: string[]; // "Router 도입 완료" 형태
    };
    technologies: string[];
    impact: string; // 1~2 문장
  };
}
