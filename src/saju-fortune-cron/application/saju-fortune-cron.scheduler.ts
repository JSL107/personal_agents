import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  cancelCatchUpsDueSoon,
  enqueueMissedRuns,
} from '../../common/queue/missed-repeatable-run';
import {
  dailyCronOf,
  DEFAULT_SAJU_FORTUNE_CRON,
  parseSajuFortuneRecipients,
  SAJU_FORTUNE_CRON_QUEUE,
  SAJU_FORTUNE_TIMEZONE,
  SajuFortuneCronJobData,
} from '../domain/saju-fortune-cron.type';

const SAJU_FORTUNE_CRON_JOB_NAME = 'saju-fortune-cron';

// 매일 사주 운세 DM — JobApplicationNudgeCronScheduler 패턴 그대로.
// 유효한 받는 사람이 한 명이라도 있으면 켜진다. 실패 알림은 공용 CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 로 간다.
@Injectable()
export class SajuFortuneCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SajuFortuneCronScheduler.name);

  constructor(
    @InjectQueue(SAJU_FORTUNE_CRON_QUEUE)
    private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { recipients, invalidEntryNumbers } = parseSajuFortuneRecipients(
      this.configService.get<string>('SAJU_FORTUNE_RECIPIENTS'),
    );
    if (invalidEntryNumbers.length > 0) {
      this.logger.warn(
        `SAJU_FORTUNE_RECIPIENTS 형식 오류 — ${invalidEntryNumbers.join(', ')}번째 항목 제외`,
      );
    }
    if (recipients.length === 0) {
      this.logger.log(
        'Saju Fortune Cron 비활성 (유효한 SAJU_FORTUNE_RECIPIENTS 없음).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const defaultCron = this.readNonEmpty(
      'SAJU_FORTUNE_CRON',
      DEFAULT_SAJU_FORTUNE_CRON,
    );
    const tz = SAJU_FORTUNE_TIMEZONE;

    const catchUps = await enqueueMissedRuns(this.queue, this.logger);
    await this.cleanupExistingRepeatables();

    // 발송 시각이 같은 사람끼리 잡 하나로 묶는다 — 사람마다 다른 시각에 받게 하기 위해서다.
    const slackUserIdsByCron = new Map<string, string[]>();
    for (const recipient of recipients) {
      const cron = recipient.sendTime
        ? dailyCronOf(recipient.sendTime)
        : defaultCron;
      slackUserIdsByCron.set(cron, [
        ...(slackUserIdsByCron.get(cron) ?? []),
        recipient.slackUserId,
      ]);
    }

    for (const [cron, recipientSlackUserIds] of slackUserIdsByCron) {
      const payload: SajuFortuneCronJobData = { recipientSlackUserIds };
      await this.queue.add(SAJU_FORTUNE_CRON_JOB_NAME, payload, {
        repeat: { pattern: cron, tz },
        jobId: `saju-fortune-cron:${cron}`,
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      });
      this.logger.log(
        `Saju Fortune Cron 활성화 — 받는 사람 ${recipientSlackUserIds.length}명, cron="${cron}" (${tz})`,
      );
    }
    await cancelCatchUpsDueSoon(this.queue, catchUps, this.logger);
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
