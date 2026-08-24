import { Injectable, Logger } from '@nestjs/common';

import { DecimalValue } from '../../../market-data/domain/market-data.type';
import { MarketDataPrismaRepository } from '../../../market-data/infrastructure/market-data.prisma.repository';
import { PrismaService } from '../../../prisma/prisma.service';
import { HoldingChangeKind, HoldingPosition } from '../domain/holding-change';
import { ValuedPosition } from '../domain/portfolio-exposure';
import {
  HoldingSnapshot,
  StockMarketCountry,
  StoredStockAlert,
} from '../domain/stock-monitor.type';

export interface RecordedHoldingChange {
  tickerId: number;
  kind: HoldingChangeKind;
  previousQuantity: string | null;
  quantity: string;
  previousAvgPrice: string | null;
  avgPrice: string;
  currency: string;
  effectiveDate: Date;
  fingerprint: string;
}

export interface AlertNeedingOutcome {
  alertId: number;
  tickerId: number;
  tradeDate: Date;
}

export interface UnscoredAlertTicker {
  tickerId: number;
  symbol: string;
  tickerName: string;
}

export interface DailyPriceForOutcome {
  tradeDate: Date;
  adjClose: DecimalValue;
}

@Injectable()
export class StockMonitorPrismaRepository {
  private readonly logger = new Logger(StockMonitorPrismaRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketDataRepository: MarketDataPrismaRepository,
  ) {}

  // 노출 비중과 평가 요약이 같은 조회를 쓴다. 평가 쪽이 평단과 직전 종가를 더 보므로
  // 봉을 2개 읽는다 — 노출 계산은 첫 봉만 쓰던 그대로다.
  async findPortfolioPositions(): Promise<ValuedPosition[]> {
    const holdings = await this.prisma.holding.findMany({
      // 전환 이력이 있는 DB의 과거 등록 경로 행이 현재 포지션에 섞이면 노출 비중이 틀어진다.
      where: { ticker: { source: 'TOSS' } },
      orderBy: { effectiveDate: 'desc' },
      include: {
        ticker: {
          include: {
            dailyPrices: {
              orderBy: { tradeDate: 'desc' },
              take: 2,
            },
          },
        },
      },
    });

    const seen = new Set<number>();
    const positions: ValuedPosition[] = [];
    for (const holding of holdings) {
      if (seen.has(holding.tickerId)) {
        continue;
      }
      seen.add(holding.tickerId);
      if (holding.quantity.isZero()) {
        continue;
      }

      const price = holding.ticker.dailyPrices[0];
      if (!price) {
        // ponytail: 일부 종목이 빠진 비중은 틀린 숫자다. 전량 조회되지 않으면 줄 자체를 생략한다.
        return [];
      }
      positions.push({
        region: holding.ticker.exposureRegion,
        direction: holding.ticker.exposureDirection,
        currency: holding.currency,
        quantity: holding.quantity,
        close: price.close,
        avgPrice: holding.avgPrice,
        previousClose: holding.ticker.dailyPrices[1]?.close ?? null,
        holdingDate: holding.effectiveDate,
      });
    }

    return positions;
  }

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
      if (!holding.ticker.tossSymbol || holding.quantity.isZero()) {
        continue;
      }
      current.push({
        tickerId: holding.tickerId,
        tickerName: holding.ticker.name,
        symbol: holding.ticker.tossSymbol,
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

  // 동기화 직전의 잔고 상태. 새 값을 덮어쓰기 전에 읽어야 매매 판정의 기준선이 된다.
  // 수량 0 행을 걸러 "보유 중인 것"만 돌려주므로, 전량 매도된 종목은 여기 나타나지 않는다.
  async findCurrentBrokerHoldings(): Promise<HoldingPosition[]> {
    const holdings = await this.prisma.holding.findMany({
      where: { ticker: { source: 'TOSS' } },
      orderBy: { effectiveDate: 'desc' },
      include: { ticker: true },
    });

    const seen = new Set<number>();
    const current: HoldingPosition[] = [];
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
        tickerName: holding.ticker.name,
        symbol: holding.ticker.tossSymbol ?? holding.ticker.code,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
        currency: holding.currency,
      });
    }
    return current;
  }

  // skipDuplicates — 겹친 실행이 계산한 같은 사건은 fingerprint 유니크에서 조용히 걸러진다.
  // 차단을 DB 에 맡기는 이유: 앞서 조회해 걸러내는 방식은 두 실행이 동시에 조회하면 둘 다
  // "없다"를 보고 둘 다 넣는다. 겹침이 정확히 그 상황이라 애플리케이션 검사로는 못 막는다.
  async recordHoldingChanges(changes: RecordedHoldingChange[]): Promise<void> {
    if (changes.length === 0) {
      return;
    }
    await this.prisma.holdingChange.createMany({
      data: changes,
      skipDuplicates: true,
    });
  }

  async upsertDailyPrice(input: {
    tickerId: number;
    tradeDate: Date;
    close: string;
    adjClose: string;
    volume: bigint;
  }): Promise<void> {
    const result = await this.marketDataRepository.upsertDailyPrice(input);
    if (result.blockedIntraday > 0) {
      this.logger.warn(
        `장중 일봉 저장 차단 — tickerId=${input.tickerId}, tradeDate=${input.tradeDate.toISOString().slice(0, 10)}`,
      );
    }
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

  async findAlertsNeedingOutcome(
    horizonDays: number,
  ): Promise<AlertNeedingOutcome[]> {
    const alerts = await this.prisma.stockAlert.findMany({
      where: { outcomes: { none: { horizonDays } } },
      orderBy: { id: 'asc' },
      select: { id: true, tickerId: true, tradeDate: true },
    });
    return alerts.map(({ id, tickerId, tradeDate }) => ({
      alertId: id,
      tickerId,
      tradeDate,
    }));
  }

  /**
   * 아직 채점되지 않은 알림이 달린 종목 — 시세를 계속 모아야 할 대상.
   *
   * 시세는 감시가 보유 종목(수량 > 0)만 훑으며 저장하므로, 알림이 울린 뒤 horizon 안에
   * 전량 매도하면 그날부터 봉이 끊긴다. 채점은 저장된 시세만 읽고 봉이 모자라면 조용히
   * 건너뛰므로, 그 알림은 **영구히 채점되지 않는다.** 크게 움직여 매도까지 이어진 알림이
   * 성적표에서 선택적으로 빠지면 평균 자체가 왜곡되기 때문에, 보유 여부와 무관하게
   * 채점이 끝날 때까지는 시세를 계속 모은다.
   */
  async findTickersWithUnscoredAlerts({
    marketCountry,
    horizonDays,
  }: {
    marketCountry: StockMarketCountry;
    horizonDays: number;
  }): Promise<UnscoredAlertTicker[]> {
    const alerts = await this.prisma.stockAlert.findMany({
      where: {
        outcomes: { none: { horizonDays } },
        ticker: { marketCountry, tossSymbol: { not: null } },
      },
      orderBy: { tickerId: 'asc' },
      distinct: ['tickerId'],
      select: {
        tickerId: true,
        ticker: { select: { tossSymbol: true, name: true } },
      },
    });

    const targets: UnscoredAlertTicker[] = [];
    for (const alert of alerts) {
      const symbol = alert.ticker.tossSymbol;
      if (!symbol) {
        continue;
      }
      targets.push({
        tickerId: alert.tickerId,
        symbol,
        tickerName: alert.ticker.name,
      });
    }
    return targets;
  }

  async findDailyPricesSince(
    tickerId: number,
    tradeDate: Date,
  ): Promise<DailyPriceForOutcome[]> {
    return await this.prisma.dailyPrice.findMany({
      where: { tickerId, tradeDate: { gte: tradeDate } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, adjClose: true },
    });
  }

  async upsertAlertOutcome(input: {
    alertId: number;
    horizonDays: number;
    firedPrice: string;
    horizonPrice: string;
    returnPct: string;
  }): Promise<void> {
    await this.prisma.alertOutcome.upsert({
      where: {
        alertId_horizonDays: {
          alertId: input.alertId,
          horizonDays: input.horizonDays,
        },
      },
      create: input,
      update: {},
    });
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

  // 아침 브리핑은 그날 환율이 아직 없다 — 저장하는 것은 저녁 감시다. 그래서 정확한 날짜가
  // 아니라 가장 최근 값을 날짜와 함께 준다. 얼마나 묵은 값인지는 부르는 쪽이 판단한다.
  async findLatestFxRate(
    pair: string,
  ): Promise<{ rate: string; rateDate: Date } | null> {
    const fxRate = await this.prisma.dailyFxRate.findFirst({
      where: { pair },
      orderBy: { rateDate: 'desc' },
      select: { rate: true, rateDate: true },
    });
    if (!fxRate) {
      return null;
    }
    return { rate: fxRate.rate.toString(), rateDate: fxRate.rateDate };
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
