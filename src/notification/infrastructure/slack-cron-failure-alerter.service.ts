import { Injectable, Logger } from '@nestjs/common';

import { SlackService } from '../../slack/slack.service';
import {
  CronFailureAlertPayload,
  CronFailureAlertPort,
} from '../domain/port/cron-failure-alert.port';

// 30분 안 동일 cron 의 실패 알람이 재시도마다 반복 발사되는 걸 막기 위한 in-memory dedupe.
// cronName 별로 별도 카운트 — 한 cron 의 dedupe 가 다른 cron 의 알람을 막지 않게.
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

// pure dedupe — spec 단위 테스트 위해 외부에서 호출 가능한 형태로 노출.
export const shouldFireCronAlert = ({
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

@Injectable()
export class SlackCronFailureAlerter implements CronFailureAlertPort {
  private readonly logger = new Logger(SlackCronFailureAlerter.name);
  // cronName → last fire timestamp (ms). cron 별 독립 dedupe.
  private readonly lastFiredAtByCron = new Map<string, number>();

  constructor(
    private readonly ownerSlackUserId: string,
    private readonly slackService: SlackService,
  ) {}

  async notifyCronFailure(payload: CronFailureAlertPayload): Promise<void> {
    const nowMs = Date.now();
    const lastFiredAtMs = this.lastFiredAtByCron.get(payload.cronName) ?? null;
    if (!shouldFireCronAlert({ lastFiredAtMs, nowMs })) {
      this.logger.debug(
        `Cron 실패 알람 — 30분 dedupe 범위 내라 skip. cron=${payload.cronName}`,
      );
      return;
    }
    this.lastFiredAtByCron.set(payload.cronName, nowMs);

    const text = [
      `⚠️ *이대리 cron 실패* — ${payload.cronName}`,
      '',
      `_owner_: \`${payload.ownerSlackUserId}\``,
      `_error_: ${payload.errorMessage.slice(0, 1500)}`,
      '',
      '_30분 안 동일 cron 의 추가 실패는 dedupe — 진단 후 봇 재기동 또는 cron 트리거 시 알람 다시 발사._',
    ].join('\n');

    try {
      await this.slackService.postMessage({
        target: this.ownerSlackUserId,
        text,
      });
      this.logger.log(
        `Cron 실패 알람 전송 — cron=${payload.cronName} owner=${this.ownerSlackUserId}`,
      );
    } catch (error: unknown) {
      // 알람 자체 실패 — bot 비활성 등. 알람의 알람을 시도하지 않고 stdout 로만 남긴다.
      this.logger.error(
        `Cron 실패 알람 전송 실패 (cron=${payload.cronName}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
