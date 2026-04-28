import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { SlackInboxRepositoryPort } from '../domain/port/slack-inbox.repository.port';
import { SlackInboxItem } from '../domain/slack-inbox.type';

@Injectable()
export class SlackInboxPrismaRepository implements SlackInboxRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(item: {
    slackUserId: string;
    channelId: string;
    messageTs: string;
    text: string;
  }): Promise<void> {
    await this.prisma.slackInboxItem.upsert({
      where: {
        slackUserId_channelId_messageTs: {
          slackUserId: item.slackUserId,
          channelId: item.channelId,
          messageTs: item.messageTs,
        },
      },
      create: item,
      update: {},
    });
  }

  async findPendingForUser(slackUserId: string): Promise<SlackInboxItem[]> {
    const rows = await this.prisma.slackInboxItem.findMany({
      where: { slackUserId, consumed: false },
      orderBy: { addedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      slackUserId: r.slackUserId,
      channelId: r.channelId,
      messageTs: r.messageTs,
      text: r.text,
      addedAt: r.addedAt,
      consumed: r.consumed,
    }));
  }

  async markConsumed(ids: number[]): Promise<void> {
    await this.prisma.slackInboxItem.updateMany({
      where: { id: { in: ids } },
      data: { consumed: true, consumedAt: new Date() },
    });
  }
}
