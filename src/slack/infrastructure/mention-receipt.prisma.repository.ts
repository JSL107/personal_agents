import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  MENTION_RECEIPT_STATUS,
  MentionReceiptRepositoryPort,
  RecordMentionOutcomeInput,
  RecordMentionReceivedInput,
} from '../domain/port/mention-receipt.repository.port';

const ERROR_MESSAGE_MAX_LENGTH = 200;

@Injectable()
export class MentionReceiptPrismaRepository implements MentionReceiptRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async recordReceived({
    source,
    channelId,
    messageTs,
  }: RecordMentionReceivedInput): Promise<void> {
    await this.prisma.mentionReceipt.createMany({
      data: [
        {
          source,
          channelId,
          messageTs,
          status: MENTION_RECEIPT_STATUS.RECEIVED,
        },
      ],
      skipDuplicates: true,
    });
  }

  async recordOutcome({
    channelId,
    messageTs,
    status,
    errorMessage,
  }: RecordMentionOutcomeInput): Promise<void> {
    await this.prisma.mentionReceipt.updateMany({
      where: { channelId, messageTs },
      data: {
        status,
        errorMessage: errorMessage?.slice(0, ERROR_MESSAGE_MAX_LENGTH) ?? null,
        repliedAt:
          status === MENTION_RECEIPT_STATUS.REPLY_FAILED ? null : new Date(),
      },
    });
  }
}
