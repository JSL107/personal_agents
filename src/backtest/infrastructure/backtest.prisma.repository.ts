import { Injectable } from '@nestjs/common';

import { BenchmarkCloseInput } from '../../paper-trading/domain/shadow-performance';
import { PrismaService } from '../../prisma/prisma.service';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';

@Injectable()
export class BacktestPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 유니버스는 재생 시작일 기준이다. `delistedAt: null` 로 좁히면 구간 안에 폐지된 종목이
  // 살아 있던 날까지 통째로 사라져, 재생이 "끝까지 살아남은 종목" 만 보는 생존 편향이 된다.
  // 폐지 이후 날짜에서 빠지는 것은 재생 루프가 봉으로 판정한다(마지막 봉이 그날이 아니면 후보 제외).
  async findUniverse(activeAsOf: Date): Promise<BacktestTicker[]> {
    const tickers = await this.prisma.ticker.findMany({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        OR: [{ delistedAt: null }, { delistedAt: { gt: activeAsOf } }],
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        krxMarket: true,
        delistedAt: true,
      },
    });
    return tickers.map((ticker) => ({
      tickerId: ticker.id,
      code: ticker.code,
      name: ticker.name,
      krxMarket: ticker.krxMarket as string,
      delistedAt: ticker.delistedAt,
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
