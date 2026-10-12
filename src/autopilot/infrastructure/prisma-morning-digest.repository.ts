import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  SLACK_DELIVERY_STATUS,
  SLACK_DELIVERY_SUPPRESS_REASON,
} from '../../slack/domain/slack-delivery.type';
import {
  DuePaperOrderCount,
  MorningDigestRepositoryPort,
  OpenIncidentRow,
} from '../domain/port/morning-digest.repository.port';

@Injectable()
export class PrismaMorningDigestRepository implements MorningDigestRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findOpenIncidents({
    seenSince,
  }: {
    seenSince: Date;
  }): Promise<OpenIncidentRow[]> {
    return this.prisma.alertIncident.findMany({
      where: { resolvedAt: null, lastSeenAt: { gte: seenSince } },
      select: { label: true, openedAt: true },
      orderBy: { openedAt: 'asc' },
    });
  }

  async findLatestStudyBrief({
    ownerUserId,
    since,
  }: {
    ownerUserId: string;
    since: Date;
  }): Promise<{ topic: string; notionUrl: string | null } | null> {
    return this.prisma.studyBrief.findFirst({
      where: { ownerUserId, createdAt: { gte: since } },
      select: { topic: true, notionUrl: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLatestConsoleText({
    itemKind,
    since,
  }: {
    itemKind: string;
    since: Date;
  }): Promise<string | null> {
    const found = await this.prisma.slackDelivery.findFirst({
      where: {
        itemKinds: { has: itemKind },
        status: SLACK_DELIVERY_STATUS.SUPPRESSED,
        suppressReason: SLACK_DELIVERY_SUPPRESS_REASON.CONSOLE_ROUTE,
        createdAt: { gte: since },
      },
      select: { fullText: true },
      orderBy: { createdAt: 'desc' },
    });
    return found?.fullText ?? null;
  }

  async countDuePaperOrders({
    tradeDate,
  }: {
    tradeDate: Date;
  }): Promise<DuePaperOrderCount> {
    // 체결기(findDuePendingOrders)와 같은 조건 — 지난 거래일에 못 채운 대기 주문도 오늘 시도된다.
    const rows = await this.prisma.paperOrder.groupBy({
      by: ['side'],
      where: { status: 'PENDING', targetTradeDate: { lte: tradeDate } },
      _count: { _all: true },
    });
    const countOf = (side: string): number =>
      rows.find((row) => row.side === side)?._count._all ?? 0;
    return { buyCount: countOf('BUY'), sellCount: countOf('SELL') };
  }
}
