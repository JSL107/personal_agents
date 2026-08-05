import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_STUDY_BRIEF_CRON,
  DEFAULT_STUDY_BRIEF_TIMEZONE,
  STUDY_BRIEF_CRON_QUEUE,
  StudyBriefCronJobData,
} from '../domain/study-brief-cron.type';

const STUDY_BRIEF_CRON_JOB_NAME = 'study-brief-cron';

@Injectable()
export class StudyBriefCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(StudyBriefCronScheduler.name);

  constructor(
    @InjectQueue(STUDY_BRIEF_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Study Brief Cron 비활성 (STUDY_BRIEF_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('STUDY_BRIEF_TARGET', owner);
    const cron = this.readNonEmpty(
      'STUDY_BRIEF_CRON',
      DEFAULT_STUDY_BRIEF_CRON,
    );
    const timezone = this.readNonEmpty(
      'STUDY_BRIEF_TIMEZONE',
      DEFAULT_STUDY_BRIEF_TIMEZONE,
    );
    await this.cleanupExistingRepeatables();

    const payload: StudyBriefCronJobData = {
      ownerSlackUserId: owner,
      target,
    };
    await this.queue.add(STUDY_BRIEF_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz: timezone },
      jobId: `study-brief-cron:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Study Brief Cron 활성화 — owner=${owner}, target=${target}, cron="${cron}" (${timezone})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'STUDY_BRIEF_OWNER_SLACK_USER_ID',
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
