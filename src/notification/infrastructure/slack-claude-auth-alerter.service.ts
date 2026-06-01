import { Injectable, Logger } from '@nestjs/common';

import { SlackService } from '../../slack/slack.service';
import { ClaudeAuthAlertPort } from '../domain/port/claude-auth-alert.port';

// 30분 안 같은 카테고리의 알람이 fallback chain 마다 반복 발사되는 걸 막기 위한 in-memory dedupe.
// 다중 인스턴스 환경에서는 인스턴스 별로 별도 카운트되지만, 운영 1대 기준이라 충분.
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

// pure dedupe — spec 단위 테스트 위해 service 외부에서 호출 가능한 형태로 노출.
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

@Injectable()
export class SlackClaudeAuthAlerter implements ClaudeAuthAlertPort {
  private readonly logger = new Logger(SlackClaudeAuthAlerter.name);
  private lastFiredAtMs: number | null = null;

  constructor(
    private readonly ownerSlackUserId: string,
    private readonly slackService: SlackService,
  ) {}

  async notifyAuthSuspect(payload: { exitMessage: string }): Promise<void> {
    const nowMs = Date.now();
    if (!shouldFireAlert({ lastFiredAtMs: this.lastFiredAtMs, nowMs })) {
      this.logger.debug(
        `claude CLI 인증 의심 알람 — 30분 dedupe 범위 내라 skip.`,
      );
      return;
    }
    this.lastFiredAtMs = nowMs;

    const text = [
      '⚠️ *이대리* — claude CLI 인증 의심 실패 감지',
      '',
      payload.exitMessage,
      '',
      '_조치: `claude` 를 대화형으로 한 번 실행해 재인증하거나 쿼터 reset window 확인. 30분 안 동일 사고는 dedupe._',
    ].join('\n');

    try {
      await this.slackService.postMessage({
        target: this.ownerSlackUserId,
        text,
      });
      this.logger.log(
        `claude CLI 인증 의심 알람 전송 — owner=${this.ownerSlackUserId}`,
      );
    } catch (error: unknown) {
      // 알람 자체 실패 — bot 비활성 (env 누락) 가능. 알람의 알람을 시도하지 않고 stdout 로만 남긴다.
      this.logger.error(
        `claude CLI 인증 의심 알람 전송 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
