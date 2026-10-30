import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  cancelCatchUpsDueSoon,
  enqueueMissedRuns,
  readNonEmptyConfig,
  removeAllRepeatables,
} from '../../common/queue/missed-repeatable-run';
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
      await removeAllRepeatables(this.queue);
      return;
    }

    const target = readNonEmptyConfig({
      configService: this.configService,
      key: 'STUDY_BRIEF_TARGET',
      fallback: owner,
    });
    const cron = readNonEmptyConfig({
      configService: this.configService,
      key: 'STUDY_BRIEF_CRON',
      fallback: DEFAULT_STUDY_BRIEF_CRON,
    });
    const timezone = readNonEmptyConfig({
      configService: this.configService,
      key: 'STUDY_BRIEF_TIMEZONE',
      fallback: DEFAULT_STUDY_BRIEF_TIMEZONE,
    });
    const catchUps = await enqueueMissedRuns(this.queue, this.logger);
    await removeAllRepeatables(this.queue);

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
    await cancelCatchUpsDueSoon(this.queue, catchUps, this.logger);
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
}
