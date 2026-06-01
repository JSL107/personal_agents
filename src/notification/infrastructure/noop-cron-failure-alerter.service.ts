import { Injectable, Logger } from '@nestjs/common';

import {
  CronFailureAlertPayload,
  CronFailureAlertPort,
} from '../domain/port/cron-failure-alert.port';

// CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID env 미설정 시 default 어댑터.
// 알람 대신 stdout 에 warn 만 — host stdout 을 보고 있는 운영 환경에서는 동일 효과.
@Injectable()
export class NoopCronFailureAlerter implements CronFailureAlertPort {
  private readonly logger = new Logger(NoopCronFailureAlerter.name);

  async notifyCronFailure(payload: CronFailureAlertPayload): Promise<void> {
    this.logger.warn(
      `CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 미설정 — 알람 noop. ` +
        `cron=${payload.cronName} owner=${payload.ownerSlackUserId} error=${payload.errorMessage.slice(0, 200)}`,
    );
  }
}
