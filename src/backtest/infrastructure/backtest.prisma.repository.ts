import { Injectable } from '@nestjs/common';

import { BenchmarkCloseInput } from '../../paper-trading/domain/shadow-performance';
import { PrismaService } from '../../prisma/prisma.service';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';

// 전 종목 5년치를 한 쿼리로 읽으면 Prisma 엔진이 결과를 문자열 하나로 넘기다 한도를 넘긴다
// (`Failed to convert rust String into napi string`). 2026-09-30 실측: 2021-11-01~2026-09-29
// 재생이 수급 열을 붙이기 전(main)에도 같은 오류로 죽었다. 종목을 나눠 읽어 한 번의 결과
// 크기를 묶는다. 이 구간은 봉 객체만으로 기본 힙도 넘기므로 `NODE_OPTIONS=--max-old-space-size`
// 를 함께 올려야 돈다.
const BAR_READ_TICKER_CHUNK_SIZE = 300;

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
    for (
      let offset = 0;
      offset < tickerIds.length;
      offset += BAR_READ_TICKER_CHUNK_SIZE
    ) {
      const rows = await this.findBarRows(
        tickerIds.slice(offset, offset + BAR_READ_TICKER_CHUNK_SIZE),
        from,
        to,
      );
      for (const row of rows) {
        const list = bars.get(row.tickerId) ?? [];
        list.push({
          tradeDate: row.tradeDate,
          open: row.open === null ? null : Number(row.open.toString()),
          close: row.close,
          adjClose: row.adjClose,
          high: row.high,
          low: row.low,
          volume: row.volume,
          foreignNetBuy: row.foreignNetBuy,
          institutionNetBuy: row.institutionNetBuy,
          flowVolume: row.flowVolume,
        });
        bars.set(row.tickerId, list);
      }
    }
    return bars;
  }

  private async findBarRows(tickerIds: number[], from: Date, to: Date) {
    return await this.prisma.dailyPrice.findMany({
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
        high: true,
        low: true,
        volume: true,
        foreignNetBuy: true,
        institutionNetBuy: true,
        flowVolume: true,
      },
    });
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
