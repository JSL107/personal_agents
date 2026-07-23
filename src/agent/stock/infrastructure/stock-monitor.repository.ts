import { Injectable } from '@nestjs/common';

import { DecimalValue } from '../../../market-data/domain/market-data.type';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  HoldingSnapshot,
  StockMarketCountry,
  StoredStockAlert,
} from '../domain/stock-monitor.type';

interface CurrentBrokerHolding {
  tickerId: number;
  avgPrice: DecimalValue;
  currency: string;
}

@Injectable()
export class StockMonitorRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 종목마다 가장 최근 effectiveDate 의 보유 행이 현재 상태다.
  async findCurrentHoldings({
    marketCountry,
  }: {
    marketCountry: StockMarketCountry;
  }): Promise<(HoldingSnapshot & { tickerId: number })[]> {
    const holdings = await this.prisma.holding.findMany({
      where: { ticker: { marketCountry } },
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
      if (!holding.ticker.yahooSymbol || holding.quantity.isZero()) {
        continue;
      }
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

  async upsertTickerFromBroker(input: {
    code: string;
    market: string;
    marketCountry: string;
    tossSymbol: string;
    name: string;
    currency: string;
  }): Promise<number> {
    const ticker = await this.prisma.ticker.upsert({
      where: {
        market_code: { market: input.market, code: input.code },
      },
      create: {
        ...input,
        source: 'TOSS',
      },
      update: {
        marketCountry: input.marketCountry,
        tossSymbol: input.tossSymbol,
        name: input.name,
        currency: input.currency,
        source: 'TOSS',
      },
      select: { id: true },
    });
    return ticker.id;
  }

  async upsertHolding(input: {
    tickerId: number;
    effectiveDate: Date;
    quantity: string;
    avgPrice: string;
    currency: string;
  }): Promise<void> {
    await this.prisma.holding.upsert({
      where: {
        tickerId_effectiveDate: {
          tickerId: input.tickerId,
          effectiveDate: input.effectiveDate,
        },
      },
      create: input,
      update: {
        quantity: input.quantity,
        avgPrice: input.avgPrice,
        currency: input.currency,
      },
    });
  }

  async findCurrentBrokerHoldings(): Promise<CurrentBrokerHolding[]> {
    const holdings = await this.prisma.holding.findMany({
      where: { ticker: { source: 'TOSS' } },
      orderBy: { effectiveDate: 'desc' },
    });

    const seen = new Set<number>();
    const current: CurrentBrokerHolding[] = [];
    for (const holding of holdings) {
      if (seen.has(holding.tickerId)) {
        continue;
      }
      seen.add(holding.tickerId);
      if (holding.quantity.isZero()) {
        continue;
      }
      current.push({
        tickerId: holding.tickerId,
        avgPrice: holding.avgPrice,
        currency: holding.currency,
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

  async upsertFxRate(input: {
    pair: string;
    rateDate: Date;
    rate: string;
  }): Promise<void> {
    await this.prisma.dailyFxRate.upsert({
      where: {
        pair_rateDate: {
          pair: input.pair,
          rateDate: input.rateDate,
        },
      },
      create: input,
      update: {
        rate: input.rate,
        fetchedAt: new Date(),
      },
    });
  }

  async findFxRate(input: {
    pair: string;
    rateDate: Date;
  }): Promise<string | null> {
    const fxRate = await this.prisma.dailyFxRate.findUnique({
      where: {
        pair_rateDate: {
          pair: input.pair,
          rateDate: input.rateDate,
        },
      },
      select: { rate: true },
    });
    return fxRate?.rate.toString() ?? null;
  }
}
