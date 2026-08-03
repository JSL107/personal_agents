import { TriggerType } from '../../../agent-run/domain/agent-run.type';

// /po-shadow 입력: 직전 PM `/today` 결과 위에 얹어서 PO 시각으로 재검토.
// extraContext 는 사용자가 추가로 주는 상황 (예: "v1.2 릴리즈 직전").
export interface GeneratePoShadowInput {
  extraContext: string;
  slackUserId: string;
  triggerType?: TriggerType;
  enforcePlanFreshness?: boolean;
}

// PO Shadow 분석 결과 — 기획서 §7.5 PO Shadow Mode 의 4가지 책임에 1:1 매핑.
export interface PoShadowReport {
  // 직전 PM plan 의 우선순위가 release/사용자 가치 관점에서 적절한지.
  priorityRecheck: string;
  // 누락된 요구사항 후보 (PM 이 미처 잡지 못한 것).
  missingRequirements: string[];
  // release 직전 발생 가능한 리스크 (rollback 어려움, 누락 검증 등).
  releaseRisks: string[];
  // "이 일의 진짜 목적" 을 다시 묻는 한 문장.
  realPurposeQuestion: string;
  // 종합 권고 (계속 진행 / 우선순위 재배치 / 일부 보류 등).
  recommendation: string;
}
