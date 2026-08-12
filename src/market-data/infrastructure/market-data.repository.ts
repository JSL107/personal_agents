import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { isIntradayCapture } from '../domain/intraday-guard';
import { KrxListing } from './krx/krx-listing.mapper';

const WRITE_CHUNK_SIZE = 200;
const MINIMUM_ACTIVE_UNIVERSE_SIZE = 1_000;

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
    const result = await this.prisma.ticker.updateMany({
      where: {
        market: 'KR',
        source: 'KRX',
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

  async findLatestTradeDateByTicker(): Promise<Map<number, string>> {
    const dates = await this.prisma.dailyPrice.groupBy({
      by: ['tickerId'],
      _max: { tradeDate: true },
    });
    const result = new Map<number, string>();
    for (const date of dates) {
      if (date._max.tradeDate) {
        result.set(
          date.tickerId,
          date._max.tradeDate.toISOString().slice(0, 10),
        );
      }
    }
    return result;
  }
}
