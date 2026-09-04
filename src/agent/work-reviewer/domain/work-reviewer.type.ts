import { TriggerType } from '../../../agent-run/domain/agent-run.type';

export interface DailyReviewImpact {
  quantitative: string[];
  qualitative: string;
}

export interface ImprovementBeforeAfter {
  before: string;
  after: string;
}

export interface DailyReview {
  summary: string;
  impact: DailyReviewImpact;
  improvementBeforeAfter: ImprovementBeforeAfter | null;
  // 세 상태를 구분한다. 값이 있으면 그 안건들, 빈 배열은 "검토했고 안건이 없다",
  // undefined 는 "그 축을 아예 검토하지 않았다".
  // undefined 가 생기는 곳은 하나뿐이다 — 이 필드 도입(2026-09-04) 이전에 원장에 적재된
  // output 을 다시 읽는 경로. 모델이 방금 낸 응답은 파서가 두 필드를 필수로 요구한다.
  decisions?: string[];
  risks?: string[];
  nextActions: string[];
  oneLineAchievement: string;
}

// 빈 배열일 때 섹션을 지우지 않고 아래 문장으로 렌더한다. 섹션이 사라지면
// "결재할 것이 없었다" 와 "회고가 그 축을 안 봤다" 가 화면에서 똑같아 보인다.
// undefined(미검토)에는 쓰지 않는다 — 안 본 것을 없다고 말하는 셈이라 거짓 부정이다.
export const NO_DECISIONS_TEXT = '결재 안건 없음';
export const NO_RISKS_TEXT = '식별된 위험 없음';

export interface GenerateWorklogInput {
  workText: string;
  slackUserId: string;
  triggerType?: TriggerType;
}
