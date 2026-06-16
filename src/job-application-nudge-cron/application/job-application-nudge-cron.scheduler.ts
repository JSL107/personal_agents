import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_JOB_APPLICATION_NUDGE_CRON,
  DEFAULT_JOB_APPLICATION_NUDGE_TIMEZONE,
  JOB_APPLICATION_NUDGE_CRON_QUEUE,
  JobApplicationNudgeCronJobData,
} from '../domain/job-application-nudge-cron.type';

const JOB_APPLICATION_NUDGE_CRON_JOB_NAME = 'job-application-nudge-cron';

// 매일 자동 지원 넛지 — ResumeCalibrationCronScheduler 패턴 그대로 (env 외부화 + 부팅 시
// repeatable 재등록 + cleanup 멱등성). owner 미설정이면 모듈 자동 비활성화 (graceful).
@Injectable()
export class JobApplicationNudgeCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobApplicationNudgeCronScheduler.name);

  constructor(
    @InjectQueue(JOB_APPLICATION_NUDGE_CRON_QUEUE)
    private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Job Application Nudge Cron 비활성 (JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('JOB_APPLICATION_NUDGE_TARGET', owner);
    const cron = this.readNonEmpty(
      'JOB_APPLICATION_NUDGE_CRON',
      DEFAULT_JOB_APPLICATION_NUDGE_CRON,
    );
    const tz = this.readNonEmpty(
      'JOB_APPLICATION_NUDGE_TIMEZONE',
      DEFAULT_JOB_APPLICATION_NUDGE_TIMEZONE,
    );

    await this.cleanupExistingRepeatables();

    const payload: JobApplicationNudgeCronJobData = {
      ownerSlackUserId: owner,
      target,
    };

    await this.queue.add(JOB_APPLICATION_NUDGE_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `job-application-nudge-cron:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Job Application Nudge Cron 활성화 — owner=${owner}, target=${target}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID',
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
