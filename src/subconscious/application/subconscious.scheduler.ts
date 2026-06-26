import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  SUBCONSCIOUS_TICK_QUEUE,
  SubconsciousTickJobData,
} from '../domain/subconscious-tick.type';

const DEFAULT_SUBCONSCIOUS_SCHEDULE = '*/20 * * * *';
const DEFAULT_SUBCONSCIOUS_TIMEZONE = 'Asia/Seoul';

// 부팅 시 SUBCONSCIOUS_ENABLED='true' + AUTOPILOT_OWNER_SLACK_USER_ID 설정이면
// 20분마다 subconscious:tick:<owner> repeatable job 을 등록한다.
// 미설정/비활성 시 기존 repeatable 정리 후 "비활성" 로그만 남긴다.
@Injectable()
export class SubconsciousScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubconsciousScheduler.name);

  constructor(
    @InjectQueue(SUBCONSCIOUS_TICK_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = this.configService.get<string>('SUBCONSCIOUS_ENABLED');
    const owner = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );

    if (enabled !== 'true' || !owner || owner.trim().length === 0) {
      this.logger.log(
        'Subconscious 비활성 (SUBCONSCIOUS_ENABLED !== "true" 또는 AUTOPILOT_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const ownerTrimmed = owner.trim();
    await this.cleanupExistingRepeatables();

    const schedule = this.readNonEmpty(
      'SUBCONSCIOUS_SCHEDULE',
      DEFAULT_SUBCONSCIOUS_SCHEDULE,
    );

    const payload: SubconsciousTickJobData = {
      ownerSlackUserId: ownerTrimmed,
    };

    await this.queue.add('tick', payload, {
      repeat: { pattern: schedule, tz: DEFAULT_SUBCONSCIOUS_TIMEZONE },
      jobId: `subconscious:tick:${ownerTrimmed}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Subconscious 활성화 — owner="${ownerTrimmed}", cron="${schedule}" (${DEFAULT_SUBCONSCIOUS_TIMEZONE})`,
    );
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
