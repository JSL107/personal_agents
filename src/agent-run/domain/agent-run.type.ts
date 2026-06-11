export enum AgentRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

// 에이전트 실행을 촉발한 트리거 출처. 기획서 §11.1 trigger_type 필드에 대응.
export enum TriggerType {
  SLACK_COMMAND_TODAY = 'SLACK_COMMAND_TODAY',
  SLACK_COMMAND_WORKLOG = 'SLACK_COMMAND_WORKLOG',
  SLACK_COMMAND_REVIEW_PR = 'SLACK_COMMAND_REVIEW_PR',
  SLACK_COMMAND_PLAN_TASK = 'SLACK_COMMAND_PLAN_TASK',
  SLACK_COMMAND_IMPACT_REPORT = 'SLACK_COMMAND_IMPACT_REPORT',
  SLACK_COMMAND_PO_SHADOW = 'SLACK_COMMAND_PO_SHADOW',
  // OPS-8: Morning Briefing CRON 자동 발화 — 수동 /today (SLACK_COMMAND_TODAY) 와 분석/Failure Replay 시 구분 가능.
  MORNING_BRIEFING_CRON = 'MORNING_BRIEFING_CRON',
  // PRO-4: Weekly Summary CRON 자동 발화 — 수동 /worklog (SLACK_COMMAND_WORKLOG) 와 구분.
  WEEKLY_SUMMARY_CRON = 'WEEKLY_SUMMARY_CRON',
  SCHEDULED = 'SCHEDULED',
  MANUAL = 'MANUAL',
  FAILURE_REPLAY = 'FAILURE_REPLAY',
  WEBHOOK = 'WEBHOOK',
  SLACK_COMMAND_BE_SCHEMA = 'SLACK_COMMAND_BE_SCHEMA',
  SLACK_COMMAND_BE_TEST = 'SLACK_COMMAND_BE_TEST',
  SLACK_COMMAND_BE_SRE = 'SLACK_COMMAND_BE_SRE',
  SLACK_COMMAND_BE_FIX = 'SLACK_COMMAND_BE_FIX',
  // V3 비전 P2 Assign — CTO worker (/assign 슬래시). PM 직전 plan 의 assignableTaskIds → BE 5종 분배.
  SLACK_COMMAND_ASSIGN = 'SLACK_COMMAND_ASSIGN',
  // V3 비전 P4 Evaluate — PO 통합 facade (/po-eval 슬래시). 3 sub-agent snapshot 합성 + careerLog.
  SLACK_COMMAND_PO_EVAL = 'SLACK_COMMAND_PO_EVAL',
  // V3 비전 P5 Meta — CEO worker (/ceo-review 슬래시). PO_EVAL + PM/CTO snapshot 합성 → drift/docs review.
  SLACK_COMMAND_CEO_REVIEW = 'SLACK_COMMAND_CEO_REVIEW',
  // PRO-4 Weekly Summary CRON 연계 — 매주 금 17:00 worklog 발송 직후 자동 CEO meta 발화 (range=WEEK).
  // WEEKLY_SUMMARY_CRON (worklog) 과 별도 — 분석/Failure Replay 시 trigger 출처 구분 가능.
  WEEKLY_CEO_META_CRON = 'WEEKLY_CEO_META_CRON',
  // V3 비전 phase loop chain — `/auto-flow` 슬래시 (PM → CTO → BE chain).
  // 사용자 명시 트리거 1회로 P1 (PM plan) → P2 (CTO 분배) → P3 (BE worker) 자동 chain 호출.
  // 본 trigger 는 chain 의 PM step 에만 명시 — CTO/BE step 은 기존 trigger 유지, chain 추적은 parentId.
  SLACK_COMMAND_AUTO_FLOW = 'SLACK_COMMAND_AUTO_FLOW',
  // workflow-phase-definition §5.2 의 Daily Eval — 매일 19:00 KST PO_EVAL (range=TODAY) 자동 트리거.
  // 수동 /po-eval (SLACK_COMMAND_PO_EVAL) 와 구분 — 분석 / Failure Replay 시 trigger 출처 명확.
  DAILY_EVAL_CRON = 'DAILY_EVAL_CRON',
  // 주 1회 자동 /impact-report --recent <N>d 종합 — 본인 작성 머지 PR 종합 보고.
  // 수동 /impact-report (SLACK_COMMAND_IMPACT_REPORT) 와 구분.
  IMPACT_REPORT_RECENT_CRON = 'IMPACT_REPORT_RECENT_CRON',
  // issues.opened webhook 자동 라벨링 — repo label vocab 안에서 LLM 이 적합 label 부분집합 선택 후
  // octokit issues.addLabels. 수동 라벨링과 구분하기 위한 trigger.
  WEBHOOK_ISSUE_AUTO_LABEL = 'WEBHOOK_ISSUE_AUTO_LABEL',
  // 휴가 계산기 슬래시 (/휴가) + 자연어 멘션 공통 trigger. 동작(조회/등록/내역/취소) 구분은 inputSnapshot.action.
  SLACK_COMMAND_VACATION = 'SLACK_COMMAND_VACATION',
  // 블로그 릴레이 — 자연어 멘션 전용(슬래시 없음)이라 COMMAND 가 아닌 MENTION 명명.
  // BlogDispatcher → GenerateBlogDraftUsecase 가 Hermes tistory-blog 스킬을 hermes -z 로 호출.
  SLACK_MENTION_BLOG = 'SLACK_MENTION_BLOG',
}

// payload 는 JSON 직렬화 가능한 임의 데이터 (object / array / primitive).
// caller 가 domain 객체를 그대로 넘기도록 unknown 으로 두고, Prisma 저장 경계에서만 InputJsonValue 로 cast.
export interface EvidenceInput {
  sourceType: string;
  sourceId: string;
  url?: string;
  title?: string;
  excerpt?: string;
  payload: unknown;
}

// V3 phase loop chain audit — AgentRun.parentId 로 연결된 root → leaf 순회 결과.
// rootRunId = 0 일 때만 자기 자신. children 이 있으면 depth=1, 2 ... 로 깊이 증가.
// 사이클은 schema 상 존재 불가 (parentId → id 단방향) 지만 application 안전망으로 maxDepth 가드.
// Slack chain 메시지 / /retry-run chain replay / CEO drift R&D 입력의 공통 회복 단위.
export interface AgentRunChainNode {
  id: number;
  parentId: number | null;
  agentType: string;
  status: AgentRunStatus;
  startedAt: Date;
  endedAt: Date | null;
  // 0 = root, 1 = direct child, 2 = grandchild ... maxDepth 초과 row 는 결과에서 제외.
  depth: number;
}
