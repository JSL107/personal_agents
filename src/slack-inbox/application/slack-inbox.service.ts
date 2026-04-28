import { Inject, Injectable } from '@nestjs/common';

import {
  SLACK_INBOX_REPOSITORY_PORT,
  SlackInboxRepositoryPort,
} from '../domain/port/slack-inbox.repository.port';
import { SlackInboxItem } from '../domain/slack-inbox.type';

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
    await this.repository.upsert(item);
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
