import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { isIntradayCapture } from '../domain/intraday-guard';
import { IndicatorBar } from '../domain/stock-indicator';
import { KrxDelisting } from './krx/krx-delisting.mapper';
import { KrxListing } from './krx/krx-listing.mapper';

const WRITE_CHUNK_SIZE = 200;
const MINIMUM_ACTIVE_UNIVERSE_SIZE = 1_000;
// 실제 상장폐지는 연간 수십 건이라 하루 5% 감소는 공급자 부분 응답으로 본다.
const MINIMUM_ACTIVE_UNIVERSE_RATIO = 0.95;
// 200거래일은 약 290일이므로 휴장·장기 연휴 여유를 포함한 400일만 DB에서 읽는다.
const BAR_READ_LOOKBACK_CALENDAR_DAYS = 400;

export interface DailyPriceWriteInput {
  tickerId: number;
  tradeDate: Date;
  // 토스 응답에 시가가 없는 캔들이 섞일 수 있어 optional 이다.
  open?: string;
  // 고가·저가도 같은 이유로 optional 이다. 셋은 같은 캔들에서 함께 오지만,
  // 하나가 빠진 응답에서 나머지까지 버리면 그 종목의 그날이 통째로 사라진다.
  high?: string;
  low?: string;
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
  oldestTradeDate: string;
}

@Injectable()
export class MarketDataPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBarsForTickers(
    tickerIds: number[],
    limit: number,
  ): Promise<Map<number, IndicatorBar[]>> {
    if (tickerIds.length === 0 || limit <= 0) {
      return new Map();
    }
    const latest = await this.prisma.dailyPrice.aggregate({
      where: { tickerId: { in: tickerIds } },
      _max: { tradeDate: true },
    });
    if (latest._max.tradeDate === null) {
      return new Map();
    }
    const earliestTradeDate = new Date(latest._max.tradeDate);
    earliestTradeDate.setUTCDate(
      earliestTradeDate.getUTCDate() - BAR_READ_LOOKBACK_CALENDAR_DAYS,
    );
    const prices = await this.prisma.dailyPrice.findMany({
      where: {
        tickerId: { in: tickerIds },
        tradeDate: { gte: earliestTradeDate },
      },
      orderBy: [{ tickerId: 'asc' }, { tradeDate: 'desc' }],
      select: {
        tickerId: true,
        tradeDate: true,
        close: true,
        adjClose: true,
        high: true,
        low: true,
        volume: true,
      },
    });
    const grouped = new Map<number, IndicatorBar[]>();
    for (const price of prices) {
      const bars = grouped.get(price.tickerId) ?? [];
      // DB별 그룹 상한 쿼리를 만들지 않고 최근순 결과에서 오래된 초과 봉만 버린다.
      if (bars.length < limit) {
        bars.push({
          tradeDate: price.tradeDate,
          close: price.close,
          adjClose: price.adjClose,
          high: price.high,
          low: price.low,
          volume: price.volume,
        });
        grouped.set(price.tickerId, bars);
      }
    }
    for (const bars of grouped.values()) {
      bars.reverse();
    }
    return grouped;
  }

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
        // undefined 면 Prisma 가 컬럼을 건드리지 않는다. 공급자가 시가·고가·저가를
        // 빠뜨린 회차에 null 을 덮어써 이미 모은 값을 잃는 일을 막는다.
        open: input.open,
        high: input.high,
        low: input.low,
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
              // undefined 면 Prisma 가 컬럼을 건드리지 않는다. 공급자가 시가·고가·저가를
              // 빠뜨린 회차에 null 을 덮어써 이미 모은 값을 잃는 일을 막는다.
              open: row.open,
              high: row.high,
              low: row.low,
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

  async applyDelistingHistory(delistings: KrxDelisting[]): Promise<number> {
    const byCode = new Map(delistings.map((item) => [item.code, item]));
    // 상장폐지 목록 전량은 1,400건이 넘지만 그중 유니버스에 행이 있는 것은 우리가 수집을
    // 시작한 뒤 사라진 종목뿐이다. 없는 종목의 행을 새로 만들지는 않는다 — 봉이 한 개도 없어
    // 재생 후보에 오르지 못하므로, 만들면 유니버스만 부풀고 쓰이지 않는다.
    //
    // 🔴 `delistedAt: { not: null }` 이 이 메서드의 방어선이다. KIND 목록에는 시장을 옮긴
    // 종목도 들어 있어서(2026-09-01 실측 54건: 코스닥 폐지 사유가 '유가증권시장 상장'),
    // 조건 없이 코드로만 맞추면 셀트리온·키움증권처럼 **지금 상장 중인 종목이 폐지 처리된다.**
    // 실제로 그렇게 56건이 유니버스에서 빠졌다. 폐지 판정은 상장법인 목록 차분
    // (`markDelistedExcept`)이 내리고, 이 메서드는 그 판정에 실제 폐지일과 사유만 붙인다.
    const targets = await this.prisma.ticker.findMany({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        delistedAt: { not: null },
        code: { in: [...byCode.keys()] },
      },
      select: { id: true, code: true, delistedAt: true, delistingReason: true },
    });

    const changes = targets.flatMap((target) => {
      const found = byCode.get(target.code);
      if (!found) {
        return [];
      }
      // 이미 같은 값이면 건너뛴다. 매 회차 전량을 받아오므로 이 검사가 없으면
      // updatedAt 이 매일 갱신돼 "언제 실제로 바뀌었나" 를 되짚을 수 없다.
      const sameDate =
        target.delistedAt?.getTime() === found.delistedAt.getTime();
      if (sameDate && target.delistingReason === found.reason) {
        return [];
      }
      return [
        { id: target.id, delistedAt: found.delistedAt, reason: found.reason },
      ];
    });

    for (let offset = 0; offset < changes.length; offset += WRITE_CHUNK_SIZE) {
      const chunk = changes.slice(offset, offset + WRITE_CHUNK_SIZE);
      await this.prisma.$transaction(
        chunk.map((change) =>
          this.prisma.ticker.update({
            where: { id: change.id },
            data: {
              // KRX 목록 차분으로 찍힌 날짜(동기화가 돈 날)를 KIND 의 실제 폐지일로 덮는다.
              delistedAt: change.delistedAt,
              delistingReason: change.reason,
            },
          }),
        ),
      );
    }
    return changes.length;
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
      _min: { tradeDate: true },
    });
    const result = new Map<number, StoredBarStat>();
    for (const stat of stats) {
      if (stat._max.tradeDate && stat._min.tradeDate) {
        result.set(stat.tickerId, {
          barCount: stat._count._all,
          latestTradeDate: stat._max.tradeDate.toISOString().slice(0, 10),
          oldestTradeDate: stat._min.tradeDate.toISOString().slice(0, 10),
        });
      }
    }
    return result;
  }
}
