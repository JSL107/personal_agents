import {
  DEFAULT_DAILY_EVAL_CRON,
  DEFAULT_DAILY_EVAL_TIMEZONE,
  DEFAULT_MORNING_BRIEFING_CRON,
  DEFAULT_MORNING_BRIEFING_TIMEZONE,
} from './autopilot.playbook-defaults';
import { PlaybookEntry } from './playbook.type';

// 자율 워크데이 플레이북 — "무엇이 언제 발화하는지" 단일 선언.
// SP1: Daily Eval 1건만(기존 cron 이관). SP2: Morning Briefing 추가(출근 통합).
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
];

// 선언 무결성 — 부팅/테스트 시 빠른 실패. (id/taskId 중복 차단)
export const validatePlaybook = (entries: PlaybookEntry[]): void => {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Autopilot 플레이북 중복 id — ${entry.id}`);
    }
    ids.add(entry.id);
  }
};
