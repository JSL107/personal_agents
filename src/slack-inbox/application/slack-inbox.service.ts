import { Inject, Injectable } from '@nestjs/common';

import {
  SLACK_INBOX_REPOSITORY_PORT,
  SlackInboxRepositoryPort,
} from '../domain/port/slack-inbox.repository.port';
import { SlackInboxItem } from '../domain/slack-inbox.type';

// Slack 메시지 1건이 PM prompt 1 섹션을 단독으로 압도하지 못하도록 한 항목당 cap.
// daily-plan-prompt.builder 의 MAX_PROMPT_BYTES=16_000 의 1/4 수준 — inbox section 이 통째로 cap 을 잡아먹지 않게.
// 단위는 UTF-8 byte — 한글/이모지가 주류인 Slack 메시지에서 String.length(UTF-16 code unit) 기준이면 한글 1자가
// 3 byte 로 부풀어 4000자만 모여도 12~16KB 가 돼 prompt cap 무력화 (codex review b… P2).
// V3 mid-progress audit B4 M-1 대응 (prompt overflow / injection 표면 축소).
const SLACK_INBOX_TEXT_MAX_BYTES = 4_000;
const TRUNCATE_SUFFIX = '\n... (생략됨 — Slack Inbox 항목 cap)';

@Injectable()
export class SlackInboxService {
  constructor(
    @Inject(SLACK_INBOX_REPOSITORY_PORT)
    private readonly repository: SlackInboxRepositoryPort,
  ) {}

  async addItem(item: {
    slackUserId: string;
    channelId: string;
    messageTs: string;
    text: string;
  }): Promise<void> {
    await this.repository.upsert({
      ...item,
      text: clampInboxText(item.text),
    });
  }

  // 사용자별 pending 항목 조회 — consumed 마킹은 별도. plan 성공 후에만 markConsumed 를 호출해
  // 중간 단계 (validation/모델/parser/persist) 가 실패해도 reacted 메시지가 손실되지 않게 한다 (codex P2).
  async peekPending(slackUserId: string): Promise<SlackInboxItem[]> {
    return this.repository.findPendingForUser(slackUserId);
  }

  async markConsumed(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.repository.markConsumed(ids);
  }
}

// UTF-8 byte 기준으로 cap. byte 자르기 시 멀티바이트 경계가 깨질 수 있으므로 toString 후
// 말미의 replacement char (U+FFFD) 를 제거. (daily-plan-prompt.builder.truncateUtf8 와 동일 패턴)
const clampInboxText = (text: string): string => {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= SLACK_INBOX_TEXT_MAX_BYTES) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(TRUNCATE_SUFFIX, 'utf8');
  const targetBytes = Math.max(0, SLACK_INBOX_TEXT_MAX_BYTES - suffixBytes);
  const sliced = buffer
    .subarray(0, targetBytes)
    .toString('utf8')
    .replace(/�$/, '');
  return `${sliced}${TRUNCATE_SUFFIX}`;
};
