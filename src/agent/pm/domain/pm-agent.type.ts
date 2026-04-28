import { TriggerType } from '../../../agent-run/domain/agent-run.type';

// 서브 태스크 (WBS) — 에이전트가 큰 태스크를 더 작은 단위로 분할한 결과.
// 2시간 이상 걸릴 것 같은 태스크만 쪼갠다 (pm-system.prompt 에 규칙).
export interface SubTask {
  title: string;
  estimatedMinutes: number;
}

// 태스크 source 식별자.
export type TaskSource =
  | 'GITHUB' // GitHub Issue/PR assigned
  | 'NOTION' // Notion task DB row
  | 'SLACK' // Slack 멘션 blocker 후보
  | 'USER_INPUT' // /today 자유 텍스트
  | 'ROLLOVER'; // 어제 미완료 이월

// 어제↔오늘 plan 간 추적 라벨 (PRO-2).
// - NEW       : 오늘 신규 등장한 태스크
// - CARRIED   : 어제 plan 에서 그대로 이어지는 태스크 (위치/시간대 동일)
// - POSTPONED : 어제 미완료를 오늘 다른 시간대로 이동
// dropped (드랍) 태스크는 plan 에 표시되지 않으므로 lineage 가 아니라 varianceAnalysis 에 기록한다.
export type TaskLineage = 'NEW' | 'CARRIED' | 'POSTPONED';

// 단일 태스크 — WBS(subtasks) + 병목(isCriticalPath) 포함.
// id 는 source 별 자연 키 (GITHUB: "owner/repo#12", NOTION: pageId, 그 외: 해시/ts 기반).
// lineage / url 은 optional — 구버전 plan 호환과 모델이 누락한 경우의 graceful 처리를 위해.
export interface TaskItem {
  id: string;
  title: string;
  source: TaskSource;
  subtasks: SubTask[];
  isCriticalPath: boolean;
  lineage?: TaskLineage;
  // GITHUB Issue/PR 또는 NOTION page 의 클릭 가능한 URL.
  // 사용자가 morning/afternoon 항목에서 어떤 업무인지 즉시 추적할 수 있도록 함 (PRO-2+).
  url?: string;
}

// 이월(Variance) 분석 — 어제 plan 과 실제 결과를 비교해 모델이 판단한 내용.
// analysisReasoning 은 사용자에게 "왜 이 이월 태스크를 오늘 어느 위치에 배치/드랍했는지" 설명용.
export interface VarianceAnalysis {
  rolledOverTasks: string[];
  analysisReasoning: string;
}

export interface DailyPlan {
  topPriority: TaskItem;
  varianceAnalysis: VarianceAnalysis;
  morning: TaskItem[];
  afternoon: TaskItem[];
  blocker: string | null;
  estimatedHours: number;
  reasoning: string;
}

export interface GenerateDailyPlanInput {
  tasksText: string;
  slackUserId: string;
  // OPS-8: 자동 발송 (Morning Briefing CRON) 등 비-슬래시 진입점에서 호출자가 명시.
  // 미지정시 수동 /today (default = SLACK_COMMAND_TODAY) 로 간주.
  triggerType?: TriggerType;
}

// /today 응답 맨 위에 노출할 "참조 소스" 엔트리 한 건. Slack 사용자가 plan 이
// "어디서 가져온 데이터" 를 근거로 만들어졌는지 즉시 판단할 수 있게 한다.
export type DailyPlanSourceType =
  | 'github_issue'
  | 'github_pull_request'
  | 'notion_task'
  | 'slack_mention'
  | 'previous_plan'
  | 'previous_worklog';

export interface DailyPlanSource {
  type: DailyPlanSourceType;
  label: string;
  url?: string;
}

export interface DailyPlanResult {
  plan: DailyPlan;
  sources: DailyPlanSource[];
}

// PM Agent `/today` 한 번 실행에 대해 AgentRun.inputSnapshot 으로 저장되는 메트릭/메타 집합.
// reporting / 디버깅 (prompt 과 크거나 context source 가 빠졌는지 추적) 용도.
export interface DailyPlanInputSnapshot {
  tasksText: string;
  slackUserId: string;
  githubItemCount: number;
  githubFetchAttempted: boolean;
  githubFetchSucceeded: boolean;
  previousPlanReferenced: boolean;
  previousPlanAgentRunId: number | null;
  previousWorklogReferenced: boolean;
  previousWorklogAgentRunId: number | null;
  slackMentionCount: number;
  slackMentionSinceHours: number;
  notionTaskCount: number;
  recentPlanLookbackDays: number;
  recentPlanSampleCount: number;
  promptByteLength: number;
  truncated: {
    github: number;
    notion: number;
    slackMentions: number;
    droppedSections: string[];
  };
}
