import {
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
  DEFAULT_RUN_RETRO_CRON,
  DEFAULT_RUN_RETRO_TIMEZONE,
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
