import { TriggerType } from '../../../agent-run/domain/agent-run.type';

// /impact-report 입력: 분석 대상 자유 텍스트 (PR 링크 / task 설명 등).
// triggerType 은 호출자 (slash / cron) 가 구분 명시 — 미지정 시 SLACK_COMMAND_IMPACT_REPORT
// (사용자 슬래시 진입). cron 자동 발화는 IMPACT_REPORT_RECENT_CRON.
export interface GenerateImpactReportInput {
  subject: string;
  slackUserId: string;
  triggerType?: TriggerType;
}

export interface ImpactBeforeAfter {
  before: string;
  after: string;
}

export interface ImpactAffectedAreas {
  users: string[];
  team: string[];
  service: string[];
}

// /impact-report 출력 — 기획서 §7.4 Work Reviewer 출력 (영향/정량/정성/한 줄 성과) 와
// 같은 결을 가지면서 "특정 태스크/PR" 단위로 좁혀 분석한 결과.
export interface ImpactReport {
  subject: string;
  headline: string;
  quantitative: string[];
  qualitative: string;
  affectedAreas: ImpactAffectedAreas;
  beforeAfter: ImpactBeforeAfter | null;
  risks: string[];
  reasoning: string;
}
