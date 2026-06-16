import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_RESUME_CALIBRATION_CRON,
  DEFAULT_RESUME_CALIBRATION_TIMEZONE,
  RESUME_CALIBRATION_CRON_QUEUE,
  ResumeCalibrationCronJobData,
} from '../domain/resume-calibration-cron.type';

const RESUME_CALIBRATION_CRON_JOB_NAME = 'resume-calibration-cron';

// 주 1회 자동 이력서 보정 점검 — CeoMetaCronScheduler 패턴 그대로 (env 외부화 + 부팅 시
// repeatable 재등록 + cleanup 멱등성). owner 미설정이면 모듈 자동 비활성화 (graceful).
@Injectable()
export class ResumeCalibrationCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResumeCalibrationCronScheduler.name);

  constructor(
    @InjectQueue(RESUME_CALIBRATION_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Resume Calibration Cron 비활성 (RESUME_CALIBRATION_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('RESUME_CALIBRATION_TARGET', owner);
    const cron = this.readNonEmpty(
      'RESUME_CALIBRATION_CRON',
      DEFAULT_RESUME_CALIBRATION_CRON,
    );
    const tz = this.readNonEmpty(
      'RESUME_CALIBRATION_TIMEZONE',
      DEFAULT_RESUME_CALIBRATION_TIMEZONE,
    );

    await this.cleanupExistingRepeatables();

    const payload: ResumeCalibrationCronJobData = {
      ownerSlackUserId: owner,
      target,
    };

    await this.queue.add(RESUME_CALIBRATION_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `resume-calibration-cron:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Resume Calibration Cron 활성화 — owner=${owner}, target=${target}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'RESUME_CALIBRATION_OWNER_SLACK_USER_ID',
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
