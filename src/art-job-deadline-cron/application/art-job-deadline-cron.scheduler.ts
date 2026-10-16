import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  enqueueMissedRuns,
  snapshotMissedRuns,
} from '../../common/queue/missed-repeatable-run';
import {
  ART_JOB_DEADLINE_CRON,
  ART_JOB_DEADLINE_CRON_QUEUE,
  ART_JOB_DEADLINE_TIMEZONE,
  ArtJobDeadlineCronJobData,
} from '../domain/art-job-deadline-cron.type';

const ART_JOB_DEADLINE_CRON_JOB_NAME = 'art-job-deadline-cron';

// JobApplicationNudgeCronScheduler 패턴 — 부팅 때 repeatable 을 지우고 다시 건다.
// 받는 사람(ART_JOB_FEED_MENTION_USER_ID)이 없으면 「관심 있음」을 누를 사람도 없으므로 비활성.
@Injectable()
export class ArtJobDeadlineCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ArtJobDeadlineCronScheduler.name);

  constructor(
    @InjectQueue(ART_JOB_DEADLINE_CRON_QUEUE)
    private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const recipient = this.readOrNull('ART_JOB_FEED_MENTION_USER_ID');
    const missedRuns = await snapshotMissedRuns(this.queue);
    await this.cleanupExistingRepeatables();
    if (!recipient) {
      this.logger.log(
        'Art Job Deadline Cron 비활성 (ART_JOB_FEED_MENTION_USER_ID 미설정).',
      );
      return;
    }

    const payload: ArtJobDeadlineCronJobData = {
      recipient,
      ownerSlackUserId: this.readOrNull('AUTOPILOT_OWNER_SLACK_USER_ID'),
    };

    await this.queue.add(ART_JOB_DEADLINE_CRON_JOB_NAME, payload, {
      repeat: { pattern: ART_JOB_DEADLINE_CRON, tz: ART_JOB_DEADLINE_TIMEZONE },
      jobId: `art-job-deadline-cron:${recipient}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Art Job Deadline Cron 활성화 — recipient=${recipient}, cron="${ART_JOB_DEADLINE_CRON}" (${ART_JOB_DEADLINE_TIMEZONE})`,
    );
    await enqueueMissedRuns(this.queue, missedRuns, this.logger);
  }

  private readOrNull(key: string): string | null {
    const trimmed = this.configService.get<string>(key)?.trim();
    return trimmed ? trimmed : null;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
