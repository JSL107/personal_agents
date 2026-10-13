import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  ART_JOB_FEED_CRON_QUEUE,
  ArtJobFeedCronJobData,
  DEFAULT_ART_JOB_FEED_CRON,
  DEFAULT_ART_JOB_FEED_TIMEZONE,
} from '../domain/art-job-feed-cron.type';

const ART_JOB_FEED_CRON_JOB_NAME = 'art-job-feed-cron';

// JobApplicationNudgeCronScheduler 패턴 — 부팅 때 repeatable 을 지우고 다시 건다.
// ART_JOB_FEED_TARGET 이 없으면 비활성(남에게 가는 발송이라 기본값으로 켜지지 않게 한다).
@Injectable()
export class ArtJobFeedCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ArtJobFeedCronScheduler.name);

  constructor(
    @InjectQueue(ART_JOB_FEED_CRON_QUEUE)
    private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const target = this.readOrNull('ART_JOB_FEED_TARGET');
    await this.cleanupExistingRepeatables();
    if (!target) {
      this.logger.log('Art Job Feed Cron 비활성 (ART_JOB_FEED_TARGET 미설정).');
      return;
    }

    const cron =
      this.readOrNull('ART_JOB_FEED_CRON') ?? DEFAULT_ART_JOB_FEED_CRON;
    const tz =
      this.readOrNull('ART_JOB_FEED_TIMEZONE') ?? DEFAULT_ART_JOB_FEED_TIMEZONE;

    const payload: ArtJobFeedCronJobData = {
      target,
      mentionUserId: this.readOrNull('ART_JOB_FEED_MENTION_USER_ID'),
      ownerSlackUserId: this.readOrNull('AUTOPILOT_OWNER_SLACK_USER_ID'),
    };

    await this.queue.add(ART_JOB_FEED_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `art-job-feed-cron:${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Art Job Feed Cron 활성화 — target=${target}, cron="${cron}" (${tz})`,
    );
  }

  private readOrNull(key: string): string | null {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
