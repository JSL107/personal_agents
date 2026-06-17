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

// 부팅 시 플레이북의 CRON 항목을 단일 큐에 named repeatable 로 등록(jobName = entry.id).
// daily-eval.scheduler 패턴 — env 외부화 + cleanup 멱등. owner 미설정이면 전체 비활성.
// EVENT 항목은 등록 skip(실행은 SP4).
@Injectable()
export class AutopilotScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutopilotScheduler.name);

  constructor(
    @InjectQueue(AUTOPILOT_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // 플레이북 무결성(중복 id 등) 부팅 시 빠른 실패 — owner 게이트보다 먼저.
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

    for (const entry of AUTOPILOT_PLAYBOOK) {
      if (entry.trigger.kind !== 'CRON') {
        continue; // EVENT 는 SP4
      }
      const envKey = entry.id.toUpperCase().replace(/-/g, '_');
      const schedule = this.readNonEmpty(
        `AUTOPILOT_${envKey}_SCHEDULE`,
        entry.trigger.schedule,
      );
      const tz = this.readNonEmpty(
        `AUTOPILOT_${envKey}_TIMEZONE`,
        entry.trigger.timezone,
      );
      const payload: AutopilotJobData = { ownerSlackUserId: owner, target };
      await this.queue.add(entry.id, payload, {
        repeat: { pattern: schedule, tz },
        jobId: `autopilot:${entry.id}:${owner}`,
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      });
      this.logger.log(
        `Autopilot 항목 활성화 — ${entry.id}, cron="${schedule}" (${tz}), target=${target}`,
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
