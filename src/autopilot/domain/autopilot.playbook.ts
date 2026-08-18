import {
  DEFAULT_AI_CLI_ENV_APPLY_CRON,
  DEFAULT_AI_CLI_ENV_APPLY_TIMEZONE,
  DEFAULT_AI_CLI_ENV_SNAPSHOT_CRON,
  DEFAULT_AI_CLI_ENV_SNAPSHOT_TIMEZONE,
  DEFAULT_CEO_META_CRON,
  DEFAULT_CEO_META_TIMEZONE,
  DEFAULT_DAILY_EVAL_CRON,
  DEFAULT_DAILY_EVAL_TIMEZONE,
  DEFAULT_DOCS_AUDIT_CRON,
  DEFAULT_DOCS_AUDIT_TIMEZONE,
  DEFAULT_IMPACT_REPORT_CRON,
  DEFAULT_IMPACT_REPORT_TIMEZONE,
  DEFAULT_KNOWLEDGE_LINT_CRON,
  DEFAULT_KNOWLEDGE_LINT_TIMEZONE,
  DEFAULT_MORNING_BRIEFING_CRON,
  DEFAULT_MORNING_BRIEFING_TIMEZONE,
  DEFAULT_NOON_REVIEW_CRON,
  DEFAULT_NOON_REVIEW_TIMEZONE,
  DEFAULT_OPS_SUPERVISOR_CRON,
  DEFAULT_OPS_SUPERVISOR_TIMEZONE,
  DEFAULT_PAPER_ORDER_FILL_CRON,
  DEFAULT_PAPER_ORDER_FILL_TIMEZONE,
  DEFAULT_PAPER_RECOMMEND_CRON,
  DEFAULT_PAPER_RECOMMEND_TIMEZONE,
  DEFAULT_PAPER_SCORE_CRON,
  DEFAULT_PAPER_SCORE_TIMEZONE,
  DEFAULT_PAPER_TRADING_CRON,
  DEFAULT_PAPER_TRADING_TIMEZONE,
  DEFAULT_PORTFOLIO_WARMUP_CRON,
  DEFAULT_PORTFOLIO_WARMUP_TIMEZONE,
  DEFAULT_PR_REVIEW_SWEEP_CRON,
  DEFAULT_PR_REVIEW_SWEEP_TIMEZONE,
  DEFAULT_PREFERENCE_LEARNING_CRON,
  DEFAULT_PREFERENCE_LEARNING_TIMEZONE,
  DEFAULT_PREVIEW_SWEEPER_CRON,
  DEFAULT_PREVIEW_SWEEPER_TIMEZONE,
  DEFAULT_RUN_RETRO_CRON,
  DEFAULT_RUN_RETRO_TIMEZONE,
  DEFAULT_RUN_SWEEPER_CRON,
  DEFAULT_RUN_SWEEPER_TIMEZONE,
  DEFAULT_STOCK_ALERT_SCORING_CRON,
  DEFAULT_STOCK_ALERT_SCORING_TIMEZONE,
  DEFAULT_STOCK_MONITOR_CRON,
  DEFAULT_STOCK_MONITOR_TIMEZONE,
  DEFAULT_STOCK_MONITOR_US_CRON,
  DEFAULT_STOCK_MONITOR_US_TIMEZONE,
  DEFAULT_UNIVERSE_SWEEP_CRON,
  DEFAULT_UNIVERSE_SWEEP_TIMEZONE,
  DEFAULT_WEEKLY_SUMMARY_CRON,
  DEFAULT_WEEKLY_SUMMARY_TIMEZONE,
} from './autopilot.playbook-defaults';
import { PlaybookEntry } from './playbook.type';

// 자율 워크데이 플레이북 — "무엇이 언제 발화하는지" 단일 선언.
// SP1: Daily Eval 1건만(기존 cron 이관). SP2: Morning Briefing 추가(출근 통합).
// SP3: work-reviewer 추가 + daily-eval digestGroup='evening' → 퇴근 1건 통합.
// SP4: 주간 cron 3종 이관 — weekly-summary(금 17:00) / ceo-meta(일 18:00) / impact-report(토 09:00).
//      각각 독립 digestGroup 없음 = 단독 그룹, 서로 다른 스케줄이라 묶지 않음.
export const AUTOPILOT_PLAYBOOK: PlaybookEntry[] = [
  // evening 그룹 순서 주의 — work-reviewer 가 daily-eval 보다 먼저여야 한다.
  // daily-eval(PO_EVAL)은 "오늘(sinceDays=1)" WORK_REVIEWER 성공 run 을 재료로 회고를 합성하는데,
  // 오케스트레이터가 같은 그룹을 배열 선언 순서대로 순차 실행하므로 work-reviewer 가 먼저 worklog run 을
  // 적재해야 daily-eval 이 그 run 을 볼 수 있다. 역순이면 daily-eval 이 조회 시점에 오늘 run 이 아직 없어
  // 항상 NO_SUB_AGENT_RUNS 로 skip 된다(매일 재발하던 순서 버그).
  {
    id: 'work-reviewer',
    taskId: 'work-reviewer',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DAILY_EVAL_CRON,
      timezone: DEFAULT_DAILY_EVAL_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
    digestGroup: 'evening',
  },
  {
    id: 'daily-eval',
    taskId: 'daily-eval',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DAILY_EVAL_CRON,
      timezone: DEFAULT_DAILY_EVAL_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
    digestGroup: 'evening',
  },
  // 저녁 회고→발행 후보 — evening 그룹 마지막(daily-eval/work-reviewer 결과가 AgentRun 에 적재된 뒤 재조회).
  // T1_PREVIEW: 블로그/경력 카드는 사용자 승인 후 실행. EVENING_RETRO_PUBLISH_ENABLED=false 시 task skip.
  {
    id: 'evening-retro-publish',
    taskId: 'evening-retro-publish',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DAILY_EVAL_CRON,
      timezone: DEFAULT_DAILY_EVAL_TIMEZONE,
    },
    riskTier: 'T1_PREVIEW',
    digestGroup: 'evening',
  },
  // 기존 evening 그룹의 schedule env 키는 첫 항목(work-reviewer) id에서 만들어진다.
  // 이 task는 그룹 맨 뒤에 두어 기존 override와 선행 회고 후보 생성을 모두 보존한다.
  {
    id: 'blog-github-publish',
    taskId: 'blog-github-publish',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DAILY_EVAL_CRON,
      timezone: DEFAULT_DAILY_EVAL_TIMEZONE,
    },
    riskTier: 'T1_PREVIEW',
    digestGroup: 'evening',
  },
  // 비서실 — 하루 한 장 결산(완료 / 진행 중 / 승인 대기 / 막힌 것 / 오늘 결정할 것 1건).
  // morning 그룹 맨 앞에 둔다: 오케스트레이터가 배열 순서대로 요약을 이어 붙이므로
  // 이 자리가 곧 메시지 맨 위다. 어제까지 적재된 기록만 보기 때문에 같은 슬롯의
  // morning-briefing 보다 먼저 실행돼도 결과가 달라지지 않는다.
  //
  // ⚠️ 이 그룹의 스케줄 env 키가 바뀐다. 스케줄러는 그룹 **첫 항목의 id** 로 키를 만들어
  //    읽으므로(autopilot.scheduler.ts), 지금까지 `AUTOPILOT_MORNING_BRIEFING_SCHEDULE`
  //    이던 것이 `AUTOPILOT_SECRETARIAT_SCHEDULE` 이 된다. 기본 스케줄 상수는 그대로
  //    재사용하므로 env 오버라이드를 쓰지 않는 환경은 동작이 같다.
  {
    id: 'secretariat',
    taskId: 'secretariat',
    trigger: {
      kind: 'CRON',
      // 그룹 내 스케줄이 다르면 validatePlaybook 이 부팅을 막는다 — 같은 상수를 쓴다.
      schedule: DEFAULT_MORNING_BRIEFING_CRON,
      timezone: DEFAULT_MORNING_BRIEFING_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
    digestGroup: 'morning',
  },
  {
    id: 'morning-briefing',
    taskId: 'morning-briefing',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_MORNING_BRIEFING_CRON,
      timezone: DEFAULT_MORNING_BRIEFING_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
    digestGroup: 'morning',
  },
  {
    id: 'assign',
    taskId: 'assign',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_NOON_REVIEW_CRON,
      timezone: DEFAULT_NOON_REVIEW_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
    digestGroup: 'noon',
  },
  {
    id: 'po-shadow',
    taskId: 'po-shadow',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_NOON_REVIEW_CRON,
      timezone: DEFAULT_NOON_REVIEW_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
    digestGroup: 'noon',
  },
  {
    id: 'weekly-summary',
    taskId: 'weekly-summary',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_WEEKLY_SUMMARY_CRON,
      timezone: DEFAULT_WEEKLY_SUMMARY_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'ceo-meta',
    taskId: 'ceo-meta',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_CEO_META_CRON,
      timezone: DEFAULT_CEO_META_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'impact-report',
    taskId: 'impact-report',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_IMPACT_REPORT_CRON,
      timezone: DEFAULT_IMPACT_REPORT_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'run-retro',
    taskId: 'run-retro',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_RUN_RETRO_CRON,
      timezone: DEFAULT_RUN_RETRO_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'run-sweeper',
    taskId: 'run-sweeper',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_RUN_SWEEPER_CRON,
      timezone: DEFAULT_RUN_SWEEPER_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  // Preview Sweeper — 매시간 만료된 승인 카드(PENDING)를 EXPIRED 로 정리(버튼 제거). 읽고 갱신만이라 T0_AUTO.
  {
    id: 'preview-sweeper',
    taskId: 'preview-sweeper',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PREVIEW_SWEEPER_CRON,
      timezone: DEFAULT_PREVIEW_SWEEPER_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'ops-supervisor',
    taskId: 'ops-supervisor',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_OPS_SUPERVISOR_CRON,
      timezone: DEFAULT_OPS_SUPERVISOR_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'stock-monitor',
    taskId: 'stock-monitor',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_STOCK_MONITOR_CRON,
      timezone: DEFAULT_STOCK_MONITOR_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  // 모의투자 평가는 독립 스케줄/env override 를 유지해야 하므로 digestGroup 에 넣지 않는다.
  {
    id: 'paper-trading',
    taskId: 'paper-trading',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PAPER_TRADING_CRON,
      timezone: DEFAULT_PAPER_TRADING_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'universe-sweep',
    taskId: 'universe-sweep',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_UNIVERSE_SWEEP_CRON,
      timezone: DEFAULT_UNIVERSE_SWEEP_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  // 유니버스 수집 완료 뒤 최신 종가로 판단한다. standalone 순서도 수집 바로 뒤를 유지한다.
  {
    id: 'paper-recommend',
    taskId: 'paper-recommend',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PAPER_RECOMMEND_CRON,
      timezone: DEFAULT_PAPER_RECOMMEND_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'paper-order-fill',
    taskId: 'paper-order-fill',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PAPER_ORDER_FILL_CRON,
      timezone: DEFAULT_PAPER_ORDER_FILL_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  // 추천/체결 진입점 뒤에 두는 독립 주간 성적표. digest 그룹 첫 항목을 바꾸지 않는다.
  {
    id: 'paper-score',
    taskId: 'paper-score',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PAPER_SCORE_CRON,
      timezone: DEFAULT_PAPER_SCORE_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'stock-alert-scoring',
    taskId: 'stock-alert-scoring',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_STOCK_ALERT_SCORING_CRON,
      timezone: DEFAULT_STOCK_ALERT_SCORING_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'stock-monitor-us',
    taskId: 'stock-monitor-us',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_STOCK_MONITOR_US_CRON,
      timezone: DEFAULT_STOCK_MONITOR_US_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  // Knowledge Lint — 주간 episodic-memory 무결성 점검(중복/임베딩 누락). 읽기 전용이라 T0_AUTO.
  {
    id: 'knowledge-lint',
    taskId: 'knowledge-lint',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_KNOWLEDGE_LINT_CRON,
      timezone: DEFAULT_KNOWLEDGE_LINT_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  // docs-sync-audit — 주간 문서↔코드 점검. T1_PREVIEW: 확정 제안은 사용자 승인 후 docs PR.
  // DOCS_AUDIT_PR_ENABLED 미설정/false 시 preview 없이 텍스트 보고로 폴백(안전).
  {
    id: 'docs-sync-audit',
    taskId: 'docs-sync-audit',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DOCS_AUDIT_CRON,
      timezone: DEFAULT_DOCS_AUDIT_TIMEZONE,
    },
    riskTier: 'T1_PREVIEW',
  },
  // Preference Learning — 주간 선호 학습. T1_PREVIEW: 추론된 프로필 diff 를 사용자 승인 후 적용.
  // AUTOPILOT_PREFERENCE_LEARNING_ENABLED 미설정/false 시 task 가 skip(안전).
  {
    id: 'preference-learning',
    taskId: 'preference-learning',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PREFERENCE_LEARNING_CRON,
      timezone: DEFAULT_PREFERENCE_LEARNING_TIMEZONE,
    },
    riskTier: 'T1_PREVIEW',
  },
  // PR 리뷰 스윕 — 열린 PR 리뷰 + 지적 카드 게시. T0_AUTO:
  // 게시는 외부 부작용이지만 레포 allowlist + 건수 상한 + 연습 모드 기본값으로 통제한다.
  // PR_REVIEW_LOOP_ENABLED 미설정/false 시 usecase 가 즉시 skip(안전).
  {
    id: 'pr-review-sweep',
    taskId: 'pr-review-sweep',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PR_REVIEW_SWEEP_CRON,
      timezone: DEFAULT_PR_REVIEW_SWEEP_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'ai-cli-env-snapshot',
    taskId: 'ai-cli-env-snapshot',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_AI_CLI_ENV_SNAPSHOT_CRON,
      timezone: DEFAULT_AI_CLI_ENV_SNAPSHOT_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
  {
    id: 'ai-cli-env-apply',
    taskId: 'ai-cli-env-apply',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_AI_CLI_ENV_APPLY_CRON,
      timezone: DEFAULT_AI_CLI_ENV_APPLY_TIMEZONE,
    },
    riskTier: 'T1_PREVIEW',
  },
  // 포트폴리오 사이트 워밍업 — 잠든 사이트 API 를 깨우고, 연속 실패 때만 알린다.
  // 공개 health GET 만 쓰므로 인증이 필요 없고 외부 부작용이 없어 T0_AUTO.
  // 배열 맨 끝에 두는 이유 — 단독 그룹이라 그룹 스케줄 env 키(AUTOPILOT_PORTFOLIO_WARMUP_SCHEDULE)가
  // 자기 id 로 정해지고, 기존 그룹의 첫 항목을 밀어내지 않는다.
  {
    id: 'portfolio-warmup',
    taskId: 'portfolio-warmup',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PORTFOLIO_WARMUP_CRON,
      timezone: DEFAULT_PORTFOLIO_WARMUP_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
];

// 선언 무결성 — 부팅/테스트 시 빠른 실패. (id/taskId 중복 차단, 그룹 스케줄 일관성 검사)
export const validatePlaybook = (entries: PlaybookEntry[]): void => {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Autopilot 플레이북 중복 id — ${entry.id}`);
    }
    ids.add(entry.id);
  }

  // 같은 digestGroup 내 CRON 항목의 schedule + timezone 일치 검사.
  // 그룹 첫 항목의 스케줄이 그룹 대표 스케줄이므로 모두 동일해야 한다.
  const groupSchedules = new Map<
    string,
    { schedule: string; timezone: string }
  >();
  for (const entry of entries) {
    if (entry.trigger.kind !== 'CRON' || !entry.digestGroup) {
      continue;
    }
    const key = entry.digestGroup;
    const { schedule, timezone } = entry.trigger;
    const existing = groupSchedules.get(key);
    if (!existing) {
      groupSchedules.set(key, { schedule, timezone });
      continue;
    }
    if (existing.schedule !== schedule || existing.timezone !== timezone) {
      throw new Error(
        `Autopilot 그룹 '${key}' 항목들의 스케줄이 불일치 — schedule/timezone 은 그룹 내 모두 동일해야 합니다`,
      );
    }
  }
};
