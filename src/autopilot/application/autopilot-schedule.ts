import { getNextMillis } from 'bullmq';

import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import { PlaybookEntry } from '../domain/playbook.type';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ResolvedCronSchedule {
  pattern: string;
  tz: string;
}

type EnvReader = (key: string) => string | undefined;

export const toScheduleEnvId = (id: string): string =>
  id.toUpperCase().replace(/-/g, '_');

// ai-cli-env 두 작업은 AUTOPILOT_ 접두 대신 전용 키를 쓴다.
const AI_CLI_ENV_SCHEDULE_KEYS: Record<
  string,
  { cron: string; timezone: string }
> = {
  'ai-cli-env-snapshot': {
    cron: 'AI_CLI_ENV_SNAPSHOT_CRON',
    timezone: 'AI_CLI_ENV_SNAPSHOT_TIMEZONE',
  },
  'ai-cli-env-apply': {
    cron: 'AI_CLI_ENV_APPLY_CRON',
    timezone: 'AI_CLI_ENV_APPLY_TIMEZONE',
  },
};

const readNonEmpty = (
  read: EnvReader,
  key: string,
  fallback: string,
): string => {
  const trimmed = read(key)?.trim();
  return trimmed ? trimmed : fallback;
};

// 그룹 첫 항목(primary)의 실제 cron. env 오버라이드(AUTOPILOT_<ID>_SCHEDULE/TIMEZONE)가 있으면 그것을 쓴다.
// 스케줄러가 등록할 때와 아침 브리핑이 결번을 판정할 때 이 한 함수를 쓴다 — 키 규칙이 두 벌이 되면
// 오버라이드를 바꿨을 때 등록과 감시가 서로 다른 cron 을 보게 된다.
export const resolveCronSchedule = (
  primary: PlaybookEntry,
  read: EnvReader,
): ResolvedCronSchedule => {
  if (primary.trigger.kind !== 'CRON') {
    throw new Error(`Autopilot: CRON 항목이 아님 — id=${primary.id}`);
  }
  const envId = toScheduleEnvId(primary.id);
  const keys = AI_CLI_ENV_SCHEDULE_KEYS[primary.id] ?? {
    cron: `AUTOPILOT_${envId}_SCHEDULE`,
    timezone: `AUTOPILOT_${envId}_TIMEZONE`,
  };
  return {
    pattern: readNonEmpty(read, keys.cron, primary.trigger.schedule),
    tz: readNonEmpty(read, keys.timezone, primary.trigger.timezone),
  };
};

// task 가 속한 그룹(digestGroup ?? id)의 실제 cron. 그룹 스케줄은 플레이북 순서상 첫 CRON 항목이
// 정한다(AutopilotScheduler 의 그룹 묶기와 같은 규칙).
export const resolveTaskCronSchedule = (
  taskId: string,
  read: EnvReader,
  playbook: readonly PlaybookEntry[] = AUTOPILOT_PLAYBOOK,
): ResolvedCronSchedule => {
  const groupKeyOf = (entry: PlaybookEntry): string =>
    entry.digestGroup ?? entry.id;
  const cronEntries = playbook.filter((entry) => entry.trigger.kind === 'CRON');
  const entry = cronEntries.find((candidate) => candidate.taskId === taskId);
  if (!entry) {
    throw new Error(`Autopilot: CRON 항목 없음 — taskId=${taskId}`);
  }
  const primary = cronEntries.find(
    (candidate) => groupKeyOf(candidate) === groupKeyOf(entry),
  );
  return resolveCronSchedule(primary ?? entry, read);
};

// `before` 직전의 마지막 회차 시각. BullMQ 가 다음 실행 시각을 정할 때 쓰는 getNextMillis 로 앞으로 훑어,
// 등록된 repeatable 과 같은 해석(같은 파서·같은 tz)을 보장한다. 하루 창을 먼저 봐서 고빈도 cron 도
// 몇백 번 안에 끝나고, 없으면 35일 창(주간·월 2회까지)으로 넓힌다. 그 안에 회차가 없으면 null.
// 잘못된 cron 이면 getNextMillis 가 던진다 — 호출부가 그 대상만 건너뛴다.
export const findLastFireBefore = (
  { pattern, tz }: ResolvedCronSchedule,
  before: Date,
): Date | null => {
  for (const lookbackDays of [1, 35]) {
    let cursor = before.getTime() - lookbackDays * DAY_MS;
    let last: number | null = null;
    for (;;) {
      const next = getNextMillis(cursor, { pattern, tz });
      if (next === undefined || next >= before.getTime()) {
        break;
      }
      last = next;
      cursor = next;
    }
    if (last !== null) {
      return new Date(last);
    }
  }
  return null;
};
