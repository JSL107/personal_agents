import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_WEEKLY_SUMMARY_CRON,
  DEFAULT_WEEKLY_SUMMARY_TIMEZONE,
  WEEKLY_SUMMARY_QUEUE,
  WeeklySummaryJobData,
} from '../domain/weekly-summary.type';

const WEEKLY_SUMMARY_JOB_NAME = 'weekly-summary';

// PRO-4 Weekly Summary Producer.
// App 부팅 시 env 를 읽어 BullMQ repeatable job 을 (재)등록한다 — 멱등성 보장 위해 기존 repeatable 들을 정리 후 재등록.
// owner / target / cron / timezone 모두 env 로 외부화. owner 미설정이면 모듈 자동 비활성화 (graceful).
@Injectable()
export class WeeklySummaryScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WeeklySummaryScheduler.name);

  constructor(
    @InjectQueue(WEEKLY_SUMMARY_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Weekly Summary 비활성 (WEEKLY_SUMMARY_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('WEEKLY_SUMMARY_TARGET', owner);
    const cron = this.readNonEmpty(
      'WEEKLY_SUMMARY_CRON',
      DEFAULT_WEEKLY_SUMMARY_CRON,
    );
    const tz = this.readNonEmpty(
      'WEEKLY_SUMMARY_TIMEZONE',
      DEFAULT_WEEKLY_SUMMARY_TIMEZONE,
    );

    // 기존 repeatable 들을 모두 정리한 뒤 재등록 — 부팅마다 owner/target/cron 변경이 그대로 반영되도록.
    await this.cleanupExistingRepeatables();

    const payload: WeeklySummaryJobData = {
      ownerSlackUserId: owner,
      target,
    };

    await this.queue.add(WEEKLY_SUMMARY_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      // jobId 는 BullMQ 에서 dedup 키 — owner/target 별로 1개 repeatable 만 살아 있도록.
      jobId: `weekly-summary:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      // 재시도 정책 — Slack 일시 장애 / 모델 timeout / 네트워크 흔들림 등 transient 실패 회복.
      // 60s → 2m 지수 백오프, 최대 2회 시도. quota 폭주 방지를 위해 attempts 제한.
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Weekly Summary 활성화 — owner=${owner}, target=${target}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'WEEKLY_SUMMARY_OWNER_SLACK_USER_ID',
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
