import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_IMPACT_REPORT_RECENT_CRON,
  DEFAULT_IMPACT_REPORT_RECENT_DAYS,
  DEFAULT_IMPACT_REPORT_RECENT_TIMEZONE,
  IMPACT_REPORT_CRON_QUEUE,
  ImpactReportCronJobData,
} from '../domain/impact-report-cron.type';

const IMPACT_REPORT_CRON_JOB_NAME = 'impact-report-cron';

// 주 1회 자동 /impact-report --recent <N>d 종합 — Weekly Summary / Daily Eval scheduler 패턴 답습.
// env 미설정 시 모듈 자동 비활성화 (graceful, Weekly/Daily 과 동일 정책).
@Injectable()
export class ImpactReportCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImpactReportCronScheduler.name);

  constructor(
    @InjectQueue(IMPACT_REPORT_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Impact Report Cron 비활성 (IMPACT_REPORT_RECENT_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('IMPACT_REPORT_RECENT_TARGET', owner);
    const cron = this.readNonEmpty(
      'IMPACT_REPORT_RECENT_CRON',
      DEFAULT_IMPACT_REPORT_RECENT_CRON,
    );
    const tz = this.readNonEmpty(
      'IMPACT_REPORT_RECENT_TIMEZONE',
      DEFAULT_IMPACT_REPORT_RECENT_TIMEZONE,
    );
    const days = this.readDays();

    await this.cleanupExistingRepeatables();

    const payload: ImpactReportCronJobData = {
      ownerSlackUserId: owner,
      target,
      days,
    };

    await this.queue.add(IMPACT_REPORT_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `impact-report-cron:${owner}->${target}:${days}d`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Impact Report Cron 활성화 — owner=${owner}, target=${target}, days=${days}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'IMPACT_REPORT_RECENT_OWNER_SLACK_USER_ID',
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

  private readDays(): number {
    const raw = this.configService.get<string>('IMPACT_REPORT_RECENT_DAYS');
    if (!raw) {
      return DEFAULT_IMPACT_REPORT_RECENT_DAYS;
    }
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 365) {
      this.logger.warn(
        `IMPACT_REPORT_RECENT_DAYS="${raw}" 비유효 — default ${DEFAULT_IMPACT_REPORT_RECENT_DAYS}일로 fallback.`,
      );
      return DEFAULT_IMPACT_REPORT_RECENT_DAYS;
    }
    return parsed;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
