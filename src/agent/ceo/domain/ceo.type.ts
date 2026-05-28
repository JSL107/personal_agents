import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentRunRange } from '../../../common/domain/agent-run-range.type';

export interface MetaInput {
  slackUserId: string;
  // 미지정 시 WEEK (CEO 의 자연 단위 — 주간 회고 + drift 점검).
  range?: AgentRunRange;
  // 미지정 시 SLACK_COMMAND_CEO_REVIEW. CRON 자동 트리거 시 WEEKLY_CEO_META_CRON 으로 구분.
  triggerType?: TriggerType;
}

// 합성 input 으로 사용된 phase run 들의 id. PO_EVAL 은 필수, PM/CTO 는 graceful.
export interface SourcePhaseRunRefs {
  // P4 Evaluate (PO_EVAL) — CEO 합성의 핵심 입력 (필수).
  poEvalRunId: number;
  // P1 Plan (PM) — 주간 plan 흐름 review 입력 (선택).
  pmRunId?: number;
  // P2 Assign (CTO) — 분배 결과 review 입력 (선택).
  ctoRunId?: number;
}

// CEO (P5 Meta) output.
// schemaVersion=1 — 컨텍스트 오염 알고리즘은 외부 선례 없어 minimal 단계는 LLM 추론만.
// 본 schema 는 workflow-phase-definition.md §4.5 의 잠정 schema (trim) — 향후 R&D plan
// 진입 시 contextDriftReport.observations 를 정량 metric 기반으로 보강 예정.
export interface MetaOutput {
  range: AgentRunRange;
  sourcePhaseRuns: SourcePhaseRunRefs;
  contextDriftReport: {
    // 컨텍스트 오염 / 방향 drift 의 관찰 결과 (LLM 추론). minimal 단계는 정량 metric X.
    observations: string[];
  };
  docsQualityReport: {
    // 문서 (CLAUDE.md / AGENTS.md / plan 등) 품질 / 누락 항목 관찰.
    findings: string[];
  };
  // 1~3 문장. 사용자 가시 footer 요약.
  finalSummary: string;
  schemaVersion: 1;
}
