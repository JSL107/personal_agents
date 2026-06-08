import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { SlackService } from '../../slack/slack.service';
import {
  ClaudeAuthSuspectJobData,
  CronFailureJobData,
  NOTIFICATION_JOB,
  NOTIFICATION_QUEUE,
  NotificationJobData,
  NotificationJobName,
} from '../domain/notification.type';

// 30분 dedupe — kind 별로 별도 Map (cron-failure 는 cronName 까지 key 에 포함).
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

// pure dedupe — spec 단위 테스트 위해 module-level export.
export const shouldFireAlert = ({
  lastFiredAtMs,
  nowMs,
  windowMs = DEDUPE_WINDOW_MS,
}: {
  lastFiredAtMs: number | null;
  nowMs: number;
  windowMs?: number;
}): boolean => {
  if (lastFiredAtMs === null) {
    return true;
  }
  return nowMs - lastFiredAtMs >= windowMs;
};

// NotificationModule 의 Consumer — SlackService 의존. Queue 의 job 을 받아 kind 별 분기 + Slack DM.
// CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID / CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID env 미설정 시 noop.
@Injectable()
@Processor(NOTIFICATION_QUEUE, {
  concurrency: 1,
  ...LONG_RUNNING_WORKER_OPTIONS,
})
export class NotificationConsumer extends WorkerHost {
  private readonly logger = new Logger(NotificationConsumer.name);
  // dedupe key → last fire timestamp (ms).
  // claude-auth-suspect 는 단일 key, cron-failure 는 cronName 별 key.
  private readonly lastFiredAtByKey = new Map<string, number>();

  constructor(
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const name = job.name as NotificationJobName;
    switch (name) {
      case NOTIFICATION_JOB.CLAUDE_AUTH_SUSPECT:
        await this.handleClaudeAuthSuspect(
          job.data as ClaudeAuthSuspectJobData,
        );
        return;
      case NOTIFICATION_JOB.CRON_FAILURE:
        await this.handleCronFailure(job.data as CronFailureJobData);
        return;
      default:
        this.logger.warn(`알 수 없는 notification job name: ${name}`);
    }
  }

  private async handleClaudeAuthSuspect(
    payload: ClaudeAuthSuspectJobData,
  ): Promise<void> {
    const ownerId = this.configService
      .get<string>('CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID')
      ?.trim();
    if (!ownerId || ownerId.length === 0) {
      this.logger.warn(
        `CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID 미설정 — 알람 skip. exit=${payload.exitMessage.slice(0, 200)}`,
      );
      return;
    }
    const dedupeKey = 'claude-auth-suspect';
    if (!this.shouldFire(dedupeKey)) {
      this.logger.debug(`claude 인증 의심 알람 — dedupe 범위 내 skip.`);
      return;
    }
    this.markFired(dedupeKey);

    const text = [
      '⚠️ *이대리* — claude CLI 인증 의심 실패 감지',
      '',
      payload.exitMessage,
      '',
      '_조치: `claude` 를 대화형으로 한 번 실행해 재인증하거나 쿼터 reset window 확인. 30분 안 동일 사고는 dedupe._',
    ].join('\n');
    await this.sendOrLog({ ownerId, text, label: 'claude-auth-suspect' });
  }

  private async handleCronFailure(payload: CronFailureJobData): Promise<void> {
    const ownerId = this.configService
      .get<string>('CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID')
      ?.trim();
    if (!ownerId || ownerId.length === 0) {
      this.logger.warn(
        `CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 미설정 — 알람 skip. cron=${payload.cronName} error=${payload.errorMessage.slice(0, 200)}`,
      );
      return;
    }
    const dedupeKey = `cron-failure:${payload.cronName}`;
    if (!this.shouldFire(dedupeKey)) {
      this.logger.debug(
        `Cron 실패 알람 — dedupe 범위 내 skip. cron=${payload.cronName}`,
      );
      return;
    }
    this.markFired(dedupeKey);

    const text = [
      `⚠️ *이대리 cron 실패* — ${payload.cronName}`,
      '',
      `_owner_: \`${payload.ownerSlackUserId}\``,
      `_error_: ${payload.errorMessage.slice(0, 1500)}`,
      '',
      '_30분 안 동일 cron 의 추가 실패는 dedupe — 진단 후 봇 재기동 또는 cron 트리거 시 알람 다시 발사._',
    ].join('\n');
    await this.sendOrLog({
      ownerId,
      text,
      label: `cron-failure:${payload.cronName}`,
    });
  }

  private shouldFire(dedupeKey: string): boolean {
    const lastFiredAtMs = this.lastFiredAtByKey.get(dedupeKey) ?? null;
    return shouldFireAlert({ lastFiredAtMs, nowMs: Date.now() });
  }

  private markFired(dedupeKey: string): void {
    this.lastFiredAtByKey.set(dedupeKey, Date.now());
  }

  private async sendOrLog({
    ownerId,
    text,
    label,
  }: {
    ownerId: string;
    text: string;
    label: string;
  }): Promise<void> {
    try {
      await this.slackService.postMessage({ target: ownerId, text });
      this.logger.log(`알람 전송 — ${label} → owner=${ownerId}`);
    } catch (error: unknown) {
      this.logger.error(
        `알람 전송 실패 (${label}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
