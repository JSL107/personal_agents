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
      const payload: AutopilotJobData = { ownerSlackUserId: owner, target };
      await this.queue.add(groupKey, payload, {
        repeat: { pattern: schedule, tz },
        jobId: `autopilot:${groupKey}:${owner}`,
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      });
      this.logger.log(
        `Autopilot 그룹 활성화 — ${groupKey}(${entries.length} task), cron="${schedule}" (${tz})`,
      );
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
