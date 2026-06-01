import { Injectable, Logger } from '@nestjs/common';

import { ClaudeAuthAlertPort } from '../domain/port/claude-auth-alert.port';

// CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID env 미설정 시 default 어댑터.
// 알람 대신 stdout 에 명시 로그만 남긴다 — 운영자가 stdout 로 보면 동일 효과 (호스트 환경에 따라).
@Injectable()
export class NoopClaudeAuthAlerter implements ClaudeAuthAlertPort {
  private readonly logger = new Logger(NoopClaudeAuthAlerter.name);

  async notifyAuthSuspect(payload: { exitMessage: string }): Promise<void> {
    this.logger.warn(
      `CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID 미설정 — 알람 노출 X. exit=${payload.exitMessage.slice(0, 200)}`,
    );
  }
}
