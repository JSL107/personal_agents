import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DAILY_EVAL_QUEUE,
  DailyEvalJobData,
  DEFAULT_DAILY_EVAL_CRON,
  DEFAULT_DAILY_EVAL_TIMEZONE,
} from '../domain/daily-eval.type';

const DAILY_EVAL_JOB_NAME = 'daily-eval';

// workflow-phase-definition §5.2 Daily Eval — 매일 19:00 KST PO_EVAL (range=TODAY) 자동 트리거.
// PRO-4 Weekly Summary scheduler 패턴 그대로 — env 외부화 + 부팅 시 repeatable 재등록 (멱등성).
// owner 미설정이면 모듈 자동 비활성화 (graceful).
@Injectable()
export class DailyEvalScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(DailyEvalScheduler.name);

  constructor(
    @InjectQueue(DAILY_EVAL_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Daily Eval 비활성 (DAILY_EVAL_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('DAILY_EVAL_TARGET', owner);
    const cron = this.readNonEmpty('DAILY_EVAL_CRON', DEFAULT_DAILY_EVAL_CRON);
    const tz = this.readNonEmpty(
      'DAILY_EVAL_TIMEZONE',
      DEFAULT_DAILY_EVAL_TIMEZONE,
    );

    await this.cleanupExistingRepeatables();

    const payload: DailyEvalJobData = {
      ownerSlackUserId: owner,
      target,
    };

    await this.queue.add(DAILY_EVAL_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `daily-eval:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Daily Eval 활성화 — owner=${owner}, target=${target}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'DAILY_EVAL_OWNER_SLACK_USER_ID',
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
