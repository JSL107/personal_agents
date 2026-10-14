import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CujDeliveryRow,
  CujLedgerReaderPort,
  CujOrderRow,
  CujPreviewRow,
  CujRunRow,
} from '../domain/port/cuj-ledger.reader.port';

const RUN_SELECT = {
  status: true,
  agentType: true,
  durationMs: true,
  startedAt: true,
  output: true,
} as const;

@Injectable()
export class CujLedgerPrismaReader implements CujLedgerReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async readPrReviews(since: Date, until: Date): Promise<CujRunRow[]> {
    return await this.prisma.agentRun.findMany({
      where: {
        triggerType: 'PR_REVIEW_SWEEP',
        agentType: 'CODE_REVIEWER',
        startedAt: { gte: since, lt: until },
      },
      select: RUN_SELECT,
    });
  }

  async readDeliveries(since: Date, until: Date): Promise<CujDeliveryRow[]> {
    return await this.prisma.slackDelivery.findMany({
      where: { createdAt: { gte: since, lt: until } },
      select: {
        status: true,
        itemKinds: true,
        createdAt: true,
        suppressReason: true,
        errorMessage: true,
      },
    });
  }

  async readPaperRecommendations(
    since: Date,
    until: Date,
  ): Promise<CujRunRow[]> {
    return await this.prisma.agentRun.findMany({
      where: {
        agentType: 'PAPER_RECOMMEND',
        startedAt: { gte: since, lt: until },
      },
      select: RUN_SELECT,
    });
  }

  async readPendingOrders(before: Date): Promise<CujOrderRow[]> {
    return await this.prisma.paperOrder.findMany({
      where: { status: 'PENDING', targetTradeDate: { lt: before } },
      select: { targetTradeDate: true },
    });
  }

  async readMentions(since: Date, until: Date): Promise<CujRunRow[]> {
    return await this.prisma.agentRun.findMany({
      where: {
        triggerType: { startsWith: 'SLACK_MENTION_' },
        startedAt: { gte: since, lt: until },
      },
      select: RUN_SELECT,
    });
  }

  async readFailedPreviews(since: Date, until: Date): Promise<CujPreviewRow[]> {
    return await this.prisma.previewAction.findMany({
      where: {
        lastFailedAt: { gte: since, lt: until },
        status: { not: 'APPLIED' },
      },
      select: { kind: true },
    });
  }
}
