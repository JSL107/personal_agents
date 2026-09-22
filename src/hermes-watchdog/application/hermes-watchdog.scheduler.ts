import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_HERMES_WATCHDOG_CRON,
  DEFAULT_HERMES_WATCHDOG_TIMEZONE,
  HERMES_WATCHDOG_QUEUE,
  HermesWatchdogJobData,
} from '../domain/hermes-watchdog.type';

const HERMES_WATCHDOG_JOB_NAME = 'hermes-watchdog';

// Hermes cron 건강 점검 예약 — ResumeCalibrationCronScheduler 패턴 그대로
// (env 외부화 + 부팅 시 repeatable 재등록 + cleanup 멱등성).
// owner 미설정이면 모듈이 조용히 비활성화된다.
@Injectable()
export class HermesWatchdogScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(HermesWatchdogScheduler.name);

  constructor(
    @InjectQueue(HERMES_WATCHDOG_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Hermes Watchdog 비활성 (HERMES_WATCHDOG_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const cron = this.readNonEmpty(
      'HERMES_WATCHDOG_CRON',
      DEFAULT_HERMES_WATCHDOG_CRON,
    );
    const tz = this.readNonEmpty(
      'HERMES_WATCHDOG_TIMEZONE',
      DEFAULT_HERMES_WATCHDOG_TIMEZONE,
    );

    await this.cleanupExistingRepeatables();

    const payload: HermesWatchdogJobData = { ownerSlackUserId: owner };

    await this.queue.add(HERMES_WATCHDOG_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `hermes-watchdog:${owner}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Hermes Watchdog 활성화 — owner=${owner}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'HERMES_WATCHDOG_OWNER_SLACK_USER_ID',
    );
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
