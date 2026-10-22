import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  SLACK_DELIVERY_STATUS,
  SLACK_DELIVERY_SUPPRESS_REASON,
} from '../../slack/domain/slack-delivery.type';
import {
  DailyDigestRepositoryPort,
  DuePaperOrderCount,
  NextPaperOrders,
  OpenIncidentRow,
  PaperAccountReturn,
} from '../domain/port/daily-digest.repository.port';

@Injectable()
export class PrismaDailyDigestRepository implements DailyDigestRepositoryPort {
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

  async findResolvedIncidentLabels({
    since,
  }: {
    since: Date;
  }): Promise<string[]> {
    const rows = await this.prisma.alertIncident.findMany({
      where: { resolvedAt: { gte: since } },
      select: { label: true },
      orderBy: { resolvedAt: 'asc' },
    });
    return rows.map((row) => row.label);
  }

  async findFirstTopLevelMessageTs({
    kind,
    target,
    since,
  }: {
    kind: string;
    target: string;
    since: Date;
  }): Promise<string | null> {
    // 가장 이른 것 — 같은 그룹이 본문 뒤에 남기는 통지(카드 보류 등)도 같은 종류의 본문이라
    // 최신을 고르면 그 통지 아래에 달린다.
    const found = await this.prisma.slackDelivery.findFirst({
      where: {
        kind,
        target,
        status: SLACK_DELIVERY_STATUS.SENT,
        threadTs: null,
        messageTs: { not: null },
        createdAt: { gte: since },
      },
      select: { messageTs: true },
      orderBy: { createdAt: 'asc' },
    });
    return found?.messageTs ?? null;
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
    return toSideCount(rows);
  }

  async findNextPaperOrders({
    tradeDate,
  }: {
    tradeDate: Date;
  }): Promise<NextPaperOrders | null> {
    const earliest = await this.prisma.paperOrder.findFirst({
      where: { status: 'PENDING', targetTradeDate: { gt: tradeDate } },
      select: { targetTradeDate: true },
      orderBy: { targetTradeDate: 'asc' },
    });
    if (!earliest?.targetTradeDate) {
      return null;
    }
    const rows = await this.prisma.paperOrder.groupBy({
      by: ['side'],
      where: { status: 'PENDING', targetTradeDate: earliest.targetTradeDate },
      _count: { _all: true },
    });
    return {
      ...toSideCount(rows),
      tradeDate: earliest.targetTradeDate.toISOString().slice(0, 10),
    };
  }

  async countPaperTrades({
    tradeDate,
  }: {
    tradeDate: Date;
  }): Promise<DuePaperOrderCount> {
    const rows = await this.prisma.paperTrade.groupBy({
      by: ['side'],
      where: { tradeDate },
      _count: { _all: true },
    });
    return toSideCount(rows);
  }

  async findPaperReturns({
    tradeDate,
  }: {
    tradeDate: Date;
  }): Promise<PaperAccountReturn[]> {
    const rows = await this.prisma.paperEquitySnapshot.findMany({
      where: { tradeDate, isBackfilled: false },
      select: { returnRate: true, account: { select: { name: true } } },
      orderBy: { accountId: 'asc' },
    });
    return rows.map((row) => ({
      accountName: row.account.name,
      returnRate: row.returnRate.toString(),
    }));
  }
}

const toSideCount = (
  rows: { side: string; _count: { _all: number } }[],
): DuePaperOrderCount => {
  const countOf = (side: string): number =>
    rows.find((row) => row.side === side)?._count._all ?? 0;
  return { buyCount: countOf('BUY'), sellCount: countOf('SELL') };
};
