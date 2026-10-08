import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  RecordSlackDeliveryInput,
  SlackDeliveryListInput,
  SlackDeliveryListRow,
  SlackDeliveryMessageRef,
  SlackDeliveryRepositoryPort,
  SlackDeliveryStatRow,
} from '../domain/port/slack-delivery.repository.port';
import { SlackDeliveryStatus } from '../domain/slack-delivery.type';

@Injectable()
export class SlackDeliveryPrismaRepository implements SlackDeliveryRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordSlackDeliveryInput): Promise<void> {
    await this.prisma.slackDelivery.create({ data: input });
  }

  async incrementReactionCount({
    channelId,
    messageTs,
  }: SlackDeliveryMessageRef): Promise<number> {
    const result = await this.prisma.slackDelivery.updateMany({
      where: { channelId, messageTs, status: 'SENT' },
      data: { reactionCount: { increment: 1 } },
    });
    return result.count;
  }

  async incrementReplyCount({
    channelId,
    messageTs,
  }: SlackDeliveryMessageRef): Promise<number> {
    const result = await this.prisma.slackDelivery.updateMany({
      where: { channelId, messageTs, status: 'SENT' },
      data: { replyCount: { increment: 1 } },
    });
    return result.count;
  }

  async findSince(since: Date, until?: Date): Promise<SlackDeliveryStatRow[]> {
    const rows = await this.prisma.slackDelivery.findMany({
      where: { createdAt: { gte: since, ...(until ? { lt: until } : {}) } },
      select: {
        kind: true,
        itemKinds: true,
        threadTs: true,
        status: true,
        suppressReason: true,
        reactionCount: true,
        replyCount: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      status: row.status as SlackDeliveryStatus,
    }));
  }

  async findByStatus({
    status,
    since,
    limit,
  }: SlackDeliveryListInput): Promise<SlackDeliveryListRow[]> {
    const rows = await this.prisma.slackDelivery.findMany({
      where: { status, createdAt: { gte: since } },
      select: {
        id: true,
        kind: true,
        itemKinds: true,
        threadTs: true,
        target: true,
        channelId: true,
        messageTs: true,
        status: true,
        suppressReason: true,
        textPreview: true,
        fullText: true,
        errorMessage: true,
        reactionCount: true,
        replyCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => ({
      ...row,
      status: row.status as SlackDeliveryStatus,
    }));
  }
}
