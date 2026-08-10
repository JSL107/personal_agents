import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  AUTOPILOT_PLAYBOOK,
  validatePlaybook,
} from '../domain/autopilot.playbook';
import {
  AUTOPILOT_CRON_QUEUE,
  AutopilotJobData,
} from '../domain/autopilot.type';
import { PlaybookEntry } from '../domain/playbook.type';

const LOW_FREQUENCY_RETRY_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential' as const, delay: 1_800_000 },
};

const DEFAULT_RETRY_OPTIONS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 60_000 },
};

const isFixedCronField = (field: string): boolean => {
  const hasSpecialSyntax = /[*\-/,]/.test(field);
  return !hasSpecialSyntax;
};

export const isLowFrequencyCron = (pattern: string): boolean => {
  const fields = pattern.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    return false;
  }

  const normalizedFields = fields.length === 6 ? fields.slice(1) : fields;
  const dayOfMonth = normalizedFields[2];
  const dayOfWeek = normalizedFields[4];
  return isFixedCronField(dayOfMonth) || isFixedCronField(dayOfWeek);
};

// 부팅 시 플레이북의 CRON 항목을 digestGroup ?? id 로 묶어 그룹당 1 repeatable 로 등록.
// 그룹 스케줄은 그룹 첫 항목의 env(AUTOPILOT_<firstId>_SCHEDULE/TIMEZONE)로 해석 — env 무변경.
// EVENT 항목은 등록 skip(실행은 SP4). owner 미설정이면 전체 비활성.
@Injectable()
export class AutopilotScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutopilotScheduler.name);

  constructor(
    @InjectQueue(AUTOPILOT_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // 플레이북 무결성(중복 id, 그룹 스케줄 일관성 등) 부팅 시 빠른 실패 — owner 게이트보다 먼저.
    validatePlaybook(AUTOPILOT_PLAYBOOK);
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Autopilot 비활성 (AUTOPILOT_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('AUTOPILOT_TARGET', owner);
    await this.cleanupExistingRepeatables();

    const groups = new Map<string, PlaybookEntry[]>();
    for (const entry of AUTOPILOT_PLAYBOOK) {
      if (entry.trigger.kind !== 'CRON') {
        continue;
      }
      const key = entry.digestGroup ?? entry.id;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(entry);
      } else {
        groups.set(key, [entry]);
      }
    }

    for (const [groupKey, entries] of groups) {
      const primary = entries[0];
      if (primary.trigger.kind !== 'CRON') {
        continue;
      }
      const envKey = primary.id.toUpperCase().replace(/-/g, '_');
      const schedule = this.readNonEmpty(
        `AUTOPILOT_${envKey}_SCHEDULE`,
        primary.trigger.schedule,
      );
      const tz = this.readNonEmpty(
        `AUTOPILOT_${envKey}_TIMEZONE`,
        primary.trigger.timezone,
      );
      this.warnIgnoredScheduleOverrides(groupKey, entries);
      const payload: AutopilotJobData = { ownerSlackUserId: owner, target };
      const retryOptions = isLowFrequencyCron(schedule)
        ? LOW_FREQUENCY_RETRY_OPTIONS
        : DEFAULT_RETRY_OPTIONS;
      await this.queue.add(groupKey, payload, {
        repeat: { pattern: schedule, tz },
        jobId: `autopilot:${groupKey}:${owner}`,
        removeOnComplete: 20,
        removeOnFail: 20,
        ...retryOptions,
      });
      this.logger.log(
        `Autopilot 그룹 활성화 — ${groupKey}(${entries.length} task), cron="${schedule}" (${tz})`,
      );
    }
  }

  /**
   * 무시되는 스케줄 override 를 경고한다.
   *
   * 그룹 스케줄은 **첫 항목 id** 로 된 키 하나만 읽는다. 그래서 플레이북 배열에서 항목
   * 순서가 바뀌면(그룹에 새 task 가 맨 앞에 들어오는 등) 그전까지 쓰던 키가 조용히
   * 무시되고 코드 기본값으로 되돌아간다. 발화 시각이 저 혼자 바뀌는데 코드 어디에도
   * 그 키 이름이 없어 원인을 찾기 어렵다 — 부팅 때 한 번 짚어 준다.
   */
  private warnIgnoredScheduleOverrides(
    groupKey: string,
    entries: PlaybookEntry[],
  ): void {
    for (const entry of entries.slice(1)) {
      const envKey = entry.id.toUpperCase().replace(/-/g, '_');
      for (const suffix of ['SCHEDULE', 'TIMEZONE']) {
        const key = `AUTOPILOT_${envKey}_${suffix}`;
        const raw = this.configService.get<string>(key);
        if (raw && raw.trim().length > 0) {
          this.logger.warn(
            `Autopilot[${groupKey}] — ${key} 는 무시됩니다. 그룹 스케줄은 첫 항목 id 기준이라 ` +
              `AUTOPILOT_${entries[0].id.toUpperCase().replace(/-/g, '_')}_${suffix} 로 옮겨야 적용됩니다.`,
          );
        }
      }
    }
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>('AUTOPILOT_OWNER_SLACK_USER_ID');
    if (!raw) {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readNonEmpty(key: string, fallback: string): string {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
