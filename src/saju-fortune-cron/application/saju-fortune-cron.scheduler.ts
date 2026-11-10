import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';

import {
  cancelCatchUpsDueSoon,
  enqueueMissedRuns,
  readNonEmptyConfig,
  removeAllRepeatables,
} from '../../common/queue/missed-repeatable-run';
import {
  dailyCronOf,
  DEFAULT_SAJU_FORTUNE_CRON,
  DEFAULT_SAJU_MISSION_CHECK_CRON,
  MISSION_CHECK_DISABLED,
  parseSajuFortuneRecipients,
  SAJU_FORTUNE_CRON_QUEUE,
  SAJU_FORTUNE_TIMEZONE,
  SajuFortuneCronJobData,
  SajuFortuneJobName,
  SajuMissionCheckJobData,
} from '../domain/saju-fortune-cron.type';

// 아침·저녁 잡이 같은 재시도·보관 정책을 쓴다. 숫자·중첩 객체(backoff)라 enum 이 아니라 BullMQ 옵션 타입으로 둔다.
const REPEAT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: 20,
  removeOnFail: 20,
  attempts: 2,
  backoff: { type: 'exponential', delay: 60_000 },
};

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
      await removeAllRepeatables(this.queue);
      return;
    }

    const defaultCron = readNonEmptyConfig({
      configService: this.configService,
      key: 'SAJU_FORTUNE_CRON',
      fallback: DEFAULT_SAJU_FORTUNE_CRON,
    });
    const tz = SAJU_FORTUNE_TIMEZONE;

    const catchUps = await enqueueMissedRuns(this.queue, this.logger);
    await removeAllRepeatables(this.queue);

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
      await this.queue.add(SajuFortuneJobName.DAILY, payload, {
        repeat: { pattern: cron, tz },
        jobId: `saju-fortune-cron:${cron}`,
        ...REPEAT_JOB_OPTIONS,
      });
      this.logger.log(
        `Saju Fortune Cron 활성화 — 받는 사람 ${recipientSlackUserIds.length}명, cron="${cron}" (${tz})`,
      );
    }
    await this.addMissionCheck();
    await cancelCatchUpsDueSoon(this.queue, catchUps, this.logger);
  }

  // 저녁 미션 확인 — 모든 받는 사람을 한 잡이 맡는다(아침 시각과 무관). 'off' 면 달지 않는다.
  private async addMissionCheck(): Promise<void> {
    const cron = readNonEmptyConfig({
      configService: this.configService,
      key: 'SAJU_MISSION_CHECK_CRON',
      fallback: DEFAULT_SAJU_MISSION_CHECK_CRON,
    });
    if (cron === MISSION_CHECK_DISABLED) {
      this.logger.log(
        'Saju Mission Check 비활성 (SAJU_MISSION_CHECK_CRON=off).',
      );
      return;
    }
    const payload: SajuMissionCheckJobData = {};
    await this.queue.add(SajuFortuneJobName.MISSION_CHECK, payload, {
      repeat: { pattern: cron, tz: SAJU_FORTUNE_TIMEZONE },
      jobId: SajuFortuneJobName.MISSION_CHECK,
      ...REPEAT_JOB_OPTIONS,
    });
    this.logger.log(
      `Saju Mission Check 활성화 — cron="${cron}" (${SAJU_FORTUNE_TIMEZONE})`,
    );
  }
}
