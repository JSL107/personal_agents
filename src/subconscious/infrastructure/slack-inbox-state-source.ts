import { Inject, Injectable } from '@nestjs/common';

import type { SlackInboxRepositoryPort } from '../../slack-inbox/domain/port/slack-inbox.repository.port';
import { SLACK_INBOX_REPOSITORY_PORT } from '../../slack-inbox/domain/port/slack-inbox.repository.port';
import { StateSource } from '../domain/port/state-source.port';
import { StateSnapshot } from '../domain/subconscious.type';
import { buildSnapshot, sha } from './snapshot.util';

@Injectable()
export class SlackInboxStateSource implements StateSource {
  readonly id = 'slack-inbox';

  constructor(
    @Inject(SLACK_INBOX_REPOSITORY_PORT)
    private readonly slackInboxRepository: SlackInboxRepositoryPort,
  ) {}

  async fetchSnapshot(ownerSlackUserId: string): Promise<StateSnapshot> {
    // findPendingForUser returns consumed=false items for the given user.
    const pendingItems =
      await this.slackInboxRepository.findPendingForUser(ownerSlackUserId);

    const items = pendingItems.map((inboxItem) => ({
      key: `inbox:${inboxItem.id}`,
      fingerprint: sha(inboxItem.messageTs),
      summary: inboxItem.text,
    }));

    return buildSnapshot(this.id, items);
  }
}
