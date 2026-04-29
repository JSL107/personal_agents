import { Inject, Injectable } from '@nestjs/common';

import {
  SLACK_INBOX_REPOSITORY_PORT,
  SlackInboxRepositoryPort,
} from '../domain/port/slack-inbox.repository.port';
import { SlackInboxItem } from '../domain/slack-inbox.type';

// Slack 메시지 1건이 PM prompt 1 섹션을 단독으로 압도하지 못하도록 한 항목당 cap.
// PM-3' MAX_PROMPT_BYTES=16_000 의 1/4 수준 — inbox section 이 통째로 cap 을 잡아먹지 않게.
// V3 mid-progress audit B4 M-1 대응 (prompt overflow / injection 표면 축소).
const SLACK_INBOX_TEXT_MAX = 4_000;

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

const clampInboxText = (text: string): string => {
  if (text.length <= SLACK_INBOX_TEXT_MAX) {
    return text;
  }
  return `${text.slice(0, SLACK_INBOX_TEXT_MAX)}\n... (생략됨 — Slack Inbox 항목 cap)`;
};
