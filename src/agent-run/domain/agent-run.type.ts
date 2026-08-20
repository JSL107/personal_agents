export enum AgentRunStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

// IN_PROGRESS 런이 이 시간을 넘기면 좀비(앱 크래시/재시작으로 고착)로 간주한다.
// run-sweeper 가 이 임계로 FAILED 정리하고(주 1회), 콘솔은 스윕 전이라도 조회 시점에
// 이 임계를 넘긴 IN_PROGRESS 를 활성에서 제외한다 — 주간 스윕 주기 vs 임계 간극(최대 6일)만큼
// 죽은 런이 "일하는 중" 으로 오표시되던 것을 즉시 교정한다. 두 경로가 같은 값을 쓰도록 단일 소스.
export const STALE_RUN_THRESHOLD_MINUTES = 30;

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
  SLACK_COMMAND_BLOG_PUBLISH = 'SLACK_COMMAND_BLOG_PUBLISH',
  SLACK_MENTION_BLOG_PUBLISH = 'SLACK_MENTION_BLOG_PUBLISH',
  // 이직 메이트 — 자연어 멘션 전용(슬래시 없음). BuildCareerProfile 의 AgentRun 트리거.
  SLACK_MENTION_CAREER_MATE = 'SLACK_MENTION_CAREER_MATE',
  // 지원 추적 CRM — 자연어 멘션 전용(슬래시 없음). Add/Update 의 AgentRun 트리거 (List 는 비래핑).
  SLACK_MENTION_JOB_APPLICATION = 'SLACK_MENTION_JOB_APPLICATION',
  // Code Reviewer 자연어 멘션 진입 — 수동 slash command와 구분해 집계·감사한다.
  SLACK_MENTION_CODE_REVIEWER = 'SLACK_MENTION_CODE_REVIEWER',
  // 같은 dispatcher 를 콘솔(REMOTE_CONSOLE)도 탄다. 멘션과 한 값으로 묶으면 경로별
  // 집계가 콘솔 실행에서 어긋나므로 분리한다.
  REMOTE_CONSOLE_CODE_REVIEWER = 'REMOTE_CONSOLE_CODE_REVIEWER',
  // PR 리뷰 루프 — cron 스윕이 발사한 리뷰. 수동 /review-pr(SLACK_COMMAND_REVIEW_PR),
  // webhook(WEBHOOK) 과 구분해 집계·감사한다.
  PR_REVIEW_SWEEP = 'PR_REVIEW_SWEEP',
  AUTOPILOT_ASSIGN_CRON = 'AUTOPILOT_ASSIGN_CRON',
  AUTOPILOT_PO_SHADOW_CRON = 'AUTOPILOT_PO_SHADOW_CRON',
  // 보유 종목 감시 — 국내/미국 두 cron 이 같은 트리거를 공유하고, 시장 구분은
  // inputSnapshot.marketCountry 로 남긴다(트리거를 시장별로 쪼개면 집계가 흩어진다).
  AUTOPILOT_INVEST_CRON = 'AUTOPILOT_INVEST_CRON',
  // 모의투자 계좌 일일 평가 — 결정론 평가 결과와 차단 사유를 원장에 적재한다.
  AUTOPILOT_PAPER_TRADING_CRON = 'AUTOPILOT_PAPER_TRADING_CRON',
  // 모의투자 추천 — 장 마감 뒤 전략별 후보와 보유 종목을 LLM이 함께 판단한다.
  AUTOPILOT_PAPER_RECOMMEND_CRON = 'AUTOPILOT_PAPER_RECOMMEND_CRON',
  // 저녁 회고→발행 후보 — evening 그룹의 T1_PREVIEW task. 블로그·경력 카드가 안 만들어진 날
  // "회고 생성이 실패했는지, 후보가 없었는지" 를 원장에서 가른다.
  AUTOPILOT_EVENING_RETRO_CRON = 'AUTOPILOT_EVENING_RETRO_CRON',
  AUTOPILOT_BLOG_PUBLISH_CRON = 'AUTOPILOT_BLOG_PUBLISH_CRON',
  // 포트폴리오 초안 발행 뒤 실행하는 이력서 증거력 감사. 발행과 원장을 분리해 감사 실패가
  // 발행 성공을 실패로 덮지 않도록 별도 trigger 로 남긴다.
  AUTOPILOT_RESUME_AUDIT_CRON = 'AUTOPILOT_RESUME_AUDIT_CRON',
  STUDY_BRIEF_CRON = 'STUDY_BRIEF_CRON',
  AUTOPILOT_STUDY_DEEPDIVE_CRON = 'AUTOPILOT_STUDY_DEEPDIVE_CRON',
  // 잠재의식 변화 감지 tick — 게이트가 죽으면 제안이 0건이 되는데, 그것이 "노이즈가 없어서"
  // 인지 "고장나서" 인지 원장 없이는 구분되지 않는다(fail-closed 라 예외도 안 올라온다).
  SUBCONSCIOUS_TICK = 'SUBCONSCIOUS_TICK',
  // 자동 보고서 윤문 — 실패해도 원본을 그대로 내보내는 best-effort 경로라,
  // 원장이 없으면 "윤문이 안 먹은 날" 이 겉으로 드러나지 않는다.
  REPORT_HUMANIZE = 'REPORT_HUMANIZE',
  // 주간 선호 학습 — 추론 실패도 skip 으로 수렴하는 경로라(task 의 skip 분기 5개 중 하나),
  // 원장이 없으면 "신호가 없어서 조용했다" 와 "모델 호출이 죽었다" 가 집계상 같아진다.
  AUTOPILOT_PREFERENCE_LEARNING_CRON = 'AUTOPILOT_PREFERENCE_LEARNING_CRON',
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
