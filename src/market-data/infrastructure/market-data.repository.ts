import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { isIntradayCapture } from '../domain/intraday-guard';
import { DailySeriesPoint } from '../domain/market-data.type';
import { KrxListing } from './krx/krx-listing.mapper';

const WRITE_CHUNK_SIZE = 200;
const SERIES_TICKER_CHUNK = 200;
const MINIMUM_ACTIVE_UNIVERSE_SIZE = 1_000;
// 실제 상장폐지는 연간 수십 건이라 하루 5% 감소는 공급자 부분 응답으로 본다.
const MINIMUM_ACTIVE_UNIVERSE_RATIO = 0.95;

export interface DailyPriceWriteInput {
  tickerId: number;
  tradeDate: Date;
  close: string;
  adjClose: string;
  volume: bigint;
}

export interface DailyPriceWriteResult {
  written: number;
  // 장중 차단을 조용한 0건과 구분해야 호출자가 운영 로그로 원인을 남길 수 있다.
  blockedIntraday: number;
}

export interface UniverseTicker {
  id: number;
  code: string;
  name: string;
  tossSymbol: string;
  krxMarket: string | null;
}

export interface StoredBarStat {
  barCount: number;
  latestTradeDate: string;
}

@Injectable()
export class MarketDataRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertDailyPrice(
    input: DailyPriceWriteInput,
    now: Date = new Date(),
  ): Promise<DailyPriceWriteResult> {
    if (isIntradayCapture(input.tradeDate, now)) {
      return { written: 0, blockedIntraday: 1 };
    }
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
        lastResyncedAt: now,
      },
    });
    return { written: 1, blockedIntraday: 0 };
  }

  async insertDailyPrices(
    rows: DailyPriceWriteInput[],
    now: Date = new Date(),
  ): Promise<DailyPriceWriteResult> {
    const safeRows = rows.filter(
      (row) => !isIntradayCapture(row.tradeDate, now),
    );
    const blockedIntraday = rows.length - safeRows.length;
    if (safeRows.length === 0) {
      return { written: 0, blockedIntraday };
    }
    const result = await this.prisma.dailyPrice.createMany({
      data: safeRows,
      skipDuplicates: true,
    });
    return { written: result.count, blockedIntraday };
  }

  async upsertDailyPrices(
    rows: DailyPriceWriteInput[],
    now: Date = new Date(),
  ): Promise<DailyPriceWriteResult> {
    const safeRows = rows.filter(
      (row) => !isIntradayCapture(row.tradeDate, now),
    );
    const blockedIntraday = rows.length - safeRows.length;
    for (let offset = 0; offset < safeRows.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = safeRows.slice(offset, offset + WRITE_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((row) =>
          this.prisma.dailyPrice.upsert({
            where: {
              tickerId_tradeDate: {
                tickerId: row.tickerId,
                tradeDate: row.tradeDate,
              },
            },
            create: row,
            update: {
              close: row.close,
              adjClose: row.adjClose,
              volume: row.volume,
              lastResyncedAt: now,
            },
          }),
        ),
      );
    }
    return { written: safeRows.length, blockedIntraday };
  }

  async findStoredCloses(
    tickerId: number,
    tradeDates: Date[],
  ): Promise<Map<string, string>> {
    if (tradeDates.length === 0) {
      return new Map();
    }
    const prices = await this.prisma.dailyPrice.findMany({
      where: { tickerId, tradeDate: { in: tradeDates } },
      select: { tradeDate: true, close: true },
    });
    return new Map(
      prices.map((price) => [
        price.tradeDate.toISOString().slice(0, 10),
        price.close.toString(),
      ]),
    );
  }

  async upsertUniverseTickers(listings: KrxListing[]): Promise<number> {
    for (let offset = 0; offset < listings.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = listings.slice(offset, offset + WRITE_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((listing) =>
          this.prisma.ticker.upsert({
            where: { market_code: { market: 'KR', code: listing.code } },
            create: {
              market: 'KR',
              marketCountry: 'KR',
              code: listing.code,
              tossSymbol: listing.code,
              currency: 'KRW',
              source: 'KRX',
              name: listing.name,
              krxMarket: listing.market,
              sector: listing.sector,
              listedAt: listing.listedAt,
              delistedAt: null,
            },
            update: {
              name: listing.name,
              krxMarket: listing.market,
              sector: listing.sector,
              listedAt: listing.listedAt,
              delistedAt: null,
            },
          }),
        ),
      );
    }
    return listings.length;
  }

  async markDelistedExcept(activeCodes: string[], asOf: Date): Promise<number> {
    if (activeCodes.length < MINIMUM_ACTIVE_UNIVERSE_SIZE) {
      return -1;
    }
    const currentActiveCount = await this.prisma.ticker.count({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        delistedAt: null,
      },
    });
    if (
      currentActiveCount > 0 &&
      activeCodes.length < currentActiveCount * MINIMUM_ACTIVE_UNIVERSE_RATIO
    ) {
      return -1;
    }
    const result = await this.prisma.ticker.updateMany({
      where: {
        market: 'KR',
        // source가 TOSS여도 krxMarket이 있으면 유니버스가 관리한다. 행은 보존되어 Holding 기반 감시에 영향이 없다.
        krxMarket: { not: null },
        code: { notIn: activeCodes },
        delistedAt: null,
      },
      data: { delistedAt: asOf },
    });
    return result.count;
  }

  async findUniverseTickers(): Promise<UniverseTicker[]> {
    const tickers = await this.prisma.ticker.findMany({
      where: {
        market: 'KR',
        // 국내 보유 종목 전체가 아니라 KRX 목록이 보통주로 분류한 행만 유니버스다.
        krxMarket: { not: null },
        delistedAt: null,
        tossSymbol: { not: null },
      },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        tossSymbol: true,
        krxMarket: true,
      },
    });
    return tickers.map((ticker) => ({
      ...ticker,
      // Prisma는 not:null 관계 필터를 반환 타입에 반영하지 않아서 repository 경계에서 좁힌다.
      tossSymbol: ticker.tossSymbol as string,
    }));
  }

  async findStoredBarStats(): Promise<Map<number, StoredBarStat>> {
    const stats = await this.prisma.dailyPrice.groupBy({
      by: ['tickerId'],
      _count: { _all: true },
      _max: { tradeDate: true },
    });
    const result = new Map<number, StoredBarStat>();
    for (const stat of stats) {
      if (stat._max.tradeDate) {
        result.set(stat.tickerId, {
          barCount: stat._count._all,
          latestTradeDate: stat._max.tradeDate.toISOString().slice(0, 10),
        });
      }
    }
    return result;
  }

  async findDailySeries(
    tickerIds: number[],
    barLimit: number,
  ): Promise<Map<number, DailySeriesPoint[]>> {
    const series = new Map<number, DailySeriesPoint[]>();
    for (
      let offset = 0;
      offset < tickerIds.length;
      offset += SERIES_TICKER_CHUNK
    ) {
      const chunk = tickerIds.slice(offset, offset + SERIES_TICKER_CHUNK);
      const rows = await this.prisma.dailyPrice.findMany({
        where: { tickerId: { in: chunk } },
        orderBy: [{ tickerId: 'asc' }, { tradeDate: 'asc' }],
        select: {
          tickerId: true,
          tradeDate: true,
          close: true,
          adjClose: true,
          volume: true,
        },
      });
      for (const row of rows) {
        const bars = series.get(row.tickerId) ?? [];
        bars.push({
          tradeDate: row.tradeDate.toISOString().slice(0, 10),
          close: row.close.toNumber(),
          adjClose: row.adjClose.toNumber(),
          volume: Number(row.volume),
        });
        series.set(row.tickerId, bars);
      }
    }
    for (const [tickerId, bars] of series) {
      series.set(tickerId, bars.slice(-barLimit));
    }
    return series;
  }
}
