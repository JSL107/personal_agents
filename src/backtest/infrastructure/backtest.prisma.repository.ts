import { Injectable } from '@nestjs/common';

import { BenchmarkCloseInput } from '../../paper-trading/domain/shadow-performance';
import { PrismaService } from '../../prisma/prisma.service';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';

@Injectable()
export class BacktestPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 재생은 현재 상장 종목만 본다. 상장폐지 종목이 빠지는 생존 편향은 설계서 §12 에 명시한 한계다.
  async findUniverse(): Promise<BacktestTicker[]> {
    const tickers = await this.prisma.ticker.findMany({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        delistedAt: null,
      },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, krxMarket: true },
    });
    return tickers.map((ticker) => ({
      tickerId: ticker.id,
      code: ticker.code,
      name: ticker.name,
      krxMarket: ticker.krxMarket as string,
    }));
  }

  // 지표는 과거 200봉을 보므로 호출자가 from 을 넉넉히 앞당겨 넘긴다.
  async findBarsInRange(
    tickerIds: number[],
    from: Date,
    to: Date,
  ): Promise<Map<number, BacktestBar[]>> {
    const bars = new Map<number, BacktestBar[]>();
    if (tickerIds.length === 0) {
      return bars;
    }
    const rows = await this.prisma.dailyPrice.findMany({
      where: {
        tickerId: { in: tickerIds },
        tradeDate: { gte: from, lte: to },
      },
      orderBy: [{ tickerId: 'asc' }, { tradeDate: 'asc' }],
      select: {
        tickerId: true,
        tradeDate: true,
        open: true,
        close: true,
        adjClose: true,
        volume: true,
      },
    });
    for (const row of rows) {
      const list = bars.get(row.tickerId) ?? [];
      list.push({
        tradeDate: row.tradeDate,
        open: row.open === null ? null : Number(row.open.toString()),
        close: row.close,
        adjClose: row.adjClose,
        volume: row.volume,
      });
      bars.set(row.tickerId, list);
    }
    return bars;
  }

  // calculateBenchmarkPerformance 가 그대로 먹을 수 있는 형태로 돌려준다.
  // symbol 값 공간은 8종이고 코스피 대비만 재므로 'KOSPI' 로 좁힌다.
  async findBenchmarkCloses(
    from: Date,
    to: Date,
  ): Promise<BenchmarkCloseInput[]> {
    const rows = await this.prisma.benchmarkDailyClose.findMany({
      where: { symbol: 'KOSPI', tradeDate: { gte: from, lte: to } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, close: true },
    });
    return rows.map((row) => ({
      tradeDate: row.tradeDate,
      close: row.close,
    }));
  }
}
