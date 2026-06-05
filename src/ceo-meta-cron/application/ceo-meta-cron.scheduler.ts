import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import {
  CEO_META_CRON_QUEUE,
  CeoMetaCronJobData,
  DEFAULT_CEO_META_CRON,
  DEFAULT_CEO_META_CRON_RANGE,
  DEFAULT_CEO_META_CRON_TIMEZONE,
} from '../domain/ceo-meta-cron.type';

const CEO_META_CRON_JOB_NAME = 'ceo-meta-cron';

// 주 1회 자동 /ceo-review — DailyEvalScheduler 패턴 그대로 (env 외부화 + 부팅 시 repeatable
// 재등록 + cleanup 멱등성). owner 미설정이면 모듈 자동 비활성화 (graceful).
@Injectable()
export class CeoMetaCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(CeoMetaCronScheduler.name);

  constructor(
    @InjectQueue(CEO_META_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'CEO Meta Cron 비활성 (CEO_META_CRON_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('CEO_META_CRON_TARGET', owner);
    const cron = this.readNonEmpty('CEO_META_CRON_CRON', DEFAULT_CEO_META_CRON);
    const tz = this.readNonEmpty(
      'CEO_META_CRON_TIMEZONE',
      DEFAULT_CEO_META_CRON_TIMEZONE,
    );
    const range = this.readRange();

    await this.cleanupExistingRepeatables();

    const payload: CeoMetaCronJobData = {
      ownerSlackUserId: owner,
      target,
      range,
    };

    await this.queue.add(CEO_META_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `ceo-meta-cron:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `CEO Meta Cron 활성화 — owner=${owner}, target=${target}, range=${range}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'CEO_META_CRON_OWNER_SLACK_USER_ID',
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

  // CEO_META_CRON_RANGE = 'TODAY' | 'WEEK'. 그 외 값은 default WEEK 로 fallback.
  private readRange(): AgentRunRange {
    const raw = this.configService
      .get<string>('CEO_META_CRON_RANGE')
      ?.trim()
      .toUpperCase();
    if (raw === 'TODAY' || raw === 'WEEK') {
      return raw;
    }
    return DEFAULT_CEO_META_CRON_RANGE;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
