import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  cancelCatchUpsDueSoon,
  enqueueMissedRuns,
  removeAllRepeatables,
} from '../../common/queue/missed-repeatable-run';
import {
  ART_JOB_FEED_CRON_QUEUE,
  DEFAULT_ART_JOB_FEED_CRON,
  DEFAULT_ART_JOB_FEED_TIMEZONE,
} from '../domain/art-job-feed-cron.type';
import {
  readArtJobFeedConfig,
  readArtJobFeedJobData,
} from './art-job-feed-job-data';

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
    const payload = readArtJobFeedJobData(this.configService);
    // 비활성이면 보충도 넣지 않는다 — 정리만 하고 끝난다.
    const catchUps = payload
      ? await enqueueMissedRuns(this.queue, this.logger)
      : new Map<string, string>();
    await removeAllRepeatables(this.queue);
    if (!payload) {
      this.logger.log('Art Job Feed Cron 비활성 (ART_JOB_FEED_TARGET 미설정).');
      return;
    }

    const cron =
      readArtJobFeedConfig(this.configService, 'ART_JOB_FEED_CRON') ??
      DEFAULT_ART_JOB_FEED_CRON;
    const tz =
      readArtJobFeedConfig(this.configService, 'ART_JOB_FEED_TIMEZONE') ??
      DEFAULT_ART_JOB_FEED_TIMEZONE;

    await this.queue.add(ART_JOB_FEED_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `art-job-feed-cron:${payload.target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Art Job Feed Cron 활성화 — target=${payload.target}, cron="${cron}" (${tz})`,
    );
    await cancelCatchUpsDueSoon(this.queue, catchUps, this.logger);
  }
}
