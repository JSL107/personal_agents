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
  decisions: string[];
  risks: string[];
  nextActions: string[];
  oneLineAchievement: string;
}

// decisions / risks 는 비어 있을 때 섹션을 지우지 않고 아래 문장으로 렌더한다.
// 섹션이 사라지면 "오늘 결재할 것이 없었다" 와 "회고가 그 축을 아예 안 봤다" 가
// 화면에서 똑같아 보인다 — 빈 값을 침묵이 아니라 명시적 부정으로 말한다.
export const NO_DECISIONS_TEXT = '결재 안건 없음';
export const NO_RISKS_TEXT = '식별된 위험 없음';

export interface GenerateWorklogInput {
  workText: string;
  slackUserId: string;
  triggerType?: TriggerType;
}
