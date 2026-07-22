import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  HoldingSnapshot,
  StoredStockAlert,
} from '../domain/stock-monitor.type';

@Injectable()
export class StockMonitorRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 종목마다 가장 최근 effectiveDate 의 보유 행이 현재 상태다.
  async findCurrentHoldings(): Promise<
    (HoldingSnapshot & { tickerId: number })[]
  > {
    const holdings = await this.prisma.holding.findMany({
      orderBy: { effectiveDate: 'desc' },
      include: { ticker: true },
    });

    const seen = new Set<number>();
    const current: (HoldingSnapshot & { tickerId: number })[] = [];
    for (const holding of holdings) {
      if (seen.has(holding.tickerId)) {
        continue;
      }
      seen.add(holding.tickerId);
      current.push({
        tickerId: holding.tickerId,
        tickerName: holding.ticker.name,
        yahooSymbol: holding.ticker.yahooSymbol,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
      });
    }
    return current;
  }

  async upsertDailyPrice(input: {
    tickerId: number;
    tradeDate: Date;
    close: string;
    adjClose: string;
    volume: bigint;
  }): Promise<void> {
    await this.prisma.dailyPrice.upsert({
      where: {
        tickerId_tradeDate: {
          tickerId: input.tickerId,
          tradeDate: input.tradeDate,
        },
      },
      create: input,
      update: {
        close: input.close,
        adjClose: input.adjClose,
        volume: input.volume,
        lastResyncedAt: new Date(),
      },
    });
  }

  async findLatestStoredTradeDate(tickerId: number): Promise<Date | null> {
    const latest = await this.prisma.dailyPrice.findFirst({
      where: { tickerId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    return latest?.tradeDate ?? null;
  }

  async recordAlert(input: {
    tickerId: number;
    tradeDate: Date;
    ruleId: string;
    ruleVersion: number;
    triggeredValue: string;
    threshold: string;
  }): Promise<void> {
    await this.prisma.stockAlert.upsert({
      where: {
        tickerId_tradeDate_ruleId: {
          tickerId: input.tickerId,
          tradeDate: input.tradeDate,
          ruleId: input.ruleId,
        },
      },
      create: input,
      update: {},
    });
  }

  async findAlertsByTradeDate(
    tickerId: number,
    tradeDate: Date,
  ): Promise<StoredStockAlert[]> {
    const alerts = await this.prisma.stockAlert.findMany({
      where: { tickerId, tradeDate },
      orderBy: { id: 'asc' },
      select: {
        ruleId: true,
        ruleVersion: true,
        triggeredValue: true,
        threshold: true,
      },
    });
    return alerts.map((alert) => ({
      ruleId: alert.ruleId,
      ruleVersion: alert.ruleVersion,
      triggeredValue: alert.triggeredValue.toNumber(),
      threshold: alert.threshold.toNumber(),
    }));
  }
}
