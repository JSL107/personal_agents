import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MoneyValue } from '../../market-data/domain/market-data.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExitBandSellOrderRecord,
  ExitBandThreshold,
} from '../domain/exit-band';
import {
  OrderStatus,
  PaperMarket,
  TradeSide,
  TradeStrategy,
} from '../domain/paper-account.type';
import {
  ApplyTradeMutation,
  FillPendingOrderInput,
  PaperAccountRecord,
  PaperOrderLedgerPort,
  PaperPositionRecord,
  PendingOrderFillResult,
} from '../domain/port/paper-order-ledger.port';
import {
  RecommendationOrderInput,
  RecommendationScoreSummary,
  RecommendationTradeInput,
} from '../domain/recommendation-score';

// 전체 훑기(findAllAccounts)는 어느 계좌인지 밝혀야 하므로 이름을 함께 싣는다.
export interface PaperAccountNamedRecord extends PaperAccountRecord {
  name: string;
}

export interface CreateAccountInput {
  name: string;
  currency: string;
  seedAmount: MoneyValue;
  openedAt: Date;
}

export interface PaperPositionWithTicker extends PaperPositionRecord {
  ticker: {
    code: string;
    name: string;
    tossSymbol: string;
  };
}

export interface ApplyTradeInput {
  accountId: number;
  tickerId: number;
  orderId?: number;
  side: TradeSide;
  strategy: TradeStrategy;
  reason?: string;
  quantity: string;
  price: string;
  tradeDate: Date;
  calculateMutation: (state: {
    account: PaperAccountRecord;
    position: PaperPositionRecord | null;
  }) => ApplyTradeMutation;
}

export interface ApplyTradeResult extends ApplyTradeMutation {
  tradeId: number;
}

export interface InvariantTradeRow {
  side: TradeSide;
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
  tax: MoneyValue;
  tickerId: number;
}

export interface PositionSnapshotInput {
  tickerId: number;
  quantity: string;
  avgPrice: string;
  price: string;
  priceDate: Date;
  isStale: boolean;
}

export interface UpsertSnapshotInput {
  accountId: number;
  tradeDate: Date;
  cashBalance: string;
  positionValue: string;
  totalValue: string;
  returnRate: string;
  staleTickerCount: number;
  benchmarkClose?: string | null;
  positions: PositionSnapshotInput[];
}

export interface SnapshotRow {
  id: number;
  tradeDate: Date;
  totalValue: MoneyValue;
  returnRate: MoneyValue;
}

export interface PendingPaperOrderInput {
  tickerId: number;
  side: TradeSide;
  quantity: string;
  strategy: TradeStrategy;
  reason: string;
  decidedAt: Date;
  dataAsOf: Date;
  targetTradeDate: Date;
  status: 'PENDING';
  indicatorSnapshot: unknown | null;
  ruleVersion: number | null;
  agentRunId: number;
}

export interface ExistingPaperOrderRecord {
  tickerId: number;
  side: string;
  quantity: MoneyValue;
  indicatorSnapshot: unknown | null;
}

export interface DuePaperOrderRecord {
  id: number;
  accountId: number;
  accountName: string;
  tickerId: number;
  tickerCode: string;
  tickerName: string;
  tossSymbol: string;
  krxMarket: string | null;
  side: TradeSide;
  quantity: MoneyValue;
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
  reason: string | null;
  targetTradeDate: Date;
}

export interface LockedPaperRecommendationState {
  account: PaperAccountRecord;
  positions: PaperPositionWithTicker[];
  latestValuation: SnapshotRow | null;
  existingOrders: ExistingPaperOrderRecord[];
}

export interface PaperRecommendationSaveDecision<T> {
  result: T;
  orders: PendingPaperOrderInput[];
}

export interface ExitBandOrderInput {
  tickerId: number;
  reason: string;
}

export interface CreateExitBandOrdersInput {
  accountId: number;
  strategy: TradeStrategy;
  decidedAt: Date;
  dataAsOf: Date;
  targetTradeDate: Date;
  agentRunId: number | null;
  // 이 회차가 쓴 밴드 설정. 주문마다 박아 둬야 값을 바꾼 전후 성적을 갈라 볼 수 있다.
  threshold: ExitBandThreshold;
  orders: ExitBandOrderInput[];
}

export interface CreateExitBandOrdersResult {
  created: number;
  // 실제로 저장된 주문의 종목만 담는다. 판정 목록을 그대로 카드에 쓰면 중복·보유 소멸로
  // 걸러진 종목까지 "예약됨" 으로 적혀 건수와 상세가 어긋난다.
  createdTickerIds: number[];
  skippedByPendingSell: number;
  skippedByNoPosition: number;
}

export interface RevalidatedPaperAccountState {
  account: PaperAccountRecord;
  positions: PaperPositionWithTicker[];
  trades: InvariantTradeRow[];
}

export interface SnapshotDecision<T> {
  snapshot: UpsertSnapshotInput | null;
  result: T;
}

export interface RecommendationScoreAccountRecord {
  id: number;
  name: Exclude<TradeStrategy, 'MANUAL'>;
  seedAmount: MoneyValue;
}

export interface RecommendationScoreDailyPriceRecord {
  tickerId: number;
  market: PaperMarket | null;
  tradeDate: Date;
  close: MoneyValue;
}

export interface RecommendationScorePortfolioTradeRecord {
  accountId: number;
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
  tax: MoneyValue;
}

export interface RecommendationScoreSnapshotRecord {
  accountId: number;
  tradeDate: Date;
  totalValue: MoneyValue;
  isBackfilled: boolean;
}

export interface LoadRecommendationScoreDataInput {
  asOf: Date;
  from?: Date;
}

// 청산 밴드별 구간 성적. 누적 행(`SaveRecommendationScoreInput`)이 계좌 전체 지표까지 담는 것과
// 달리 사이클 성적만 담는다 — 자산 수익률·MDD·회전율은 구간으로 자를 수 없는 축이다.
export interface SaveRecommendationScorePeriodInput {
  accountId: number;
  asOf: Date;
  periodLabel: string;
  strategy: string;
  closedCount: number;
  hitCount: number;
  hitRate: string | null;
  meanReturnRate: string | null;
  medianReturnRate: string | null;
  maximumLoss: string | null;
  averageHoldingDays: string | null;
}

export interface SaveRecommendationScoreInput {
  accountId: number;
  strategy: string;
  asOf: Date;
  ruleVersions: number[];
  unknownRuleVersionCount: number;
  exitBands: string[];
  bandlessSellCount: number;
  recommendationCount: number;
  closedCount: number;
  openCount: number;
  expiredCount: number;
  hitCount: number;
  hitRate: string | null;
  meanReturnRate: string | null;
  medianReturnRate: string | null;
  maximumLoss: string | null;
  averageHoldingDays: string | null;
  meanExcessReturnRate: string | null;
  meanShadowReturnRate: string | null;
  snapshotCount: number;
  accountReturnRate: string | null;
  maximumDrawdown: string | null;
  turnoverRate: string | null;
  cumulativeCost: string;
  exclusions: Record<string, number>;
}

// 채점 구간의 매도 주문에 박힌 밴드 설정. 매수(orders)와 달리 사이클에 귀속시키지 않고
// `id` 는 사이클별 귀속에 쓴다 — 매도 체결의 `orderId` 와 맞춰 그 사이클이 어느 밴드에서
// 닫혔는지 가른다(`splitCyclesByExitBand`). 구간 집계가 생기기 전에는 밴드 집합만 필요해
// 싣지 않았다.
export interface RecommendationScoreSellOrderRecord extends ExitBandSellOrderRecord {
  id: number;
  accountId: number;
}

export interface RecommendationScoreData {
  accounts: RecommendationScoreAccountRecord[];
  orders: RecommendationOrderInput[];
  sellOrders: RecommendationScoreSellOrderRecord[];
  recommendationTrades: RecommendationTradeInput[];
  portfolioTrades: RecommendationScorePortfolioTradeRecord[];
  dailyPrices: RecommendationScoreDailyPriceRecord[];
  benchmarkCloses: Array<{ tradeDate: Date; close: MoneyValue }>;
  snapshots: RecommendationScoreSnapshotRecord[];
}

const isUniqueConstraintError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'P2002';
};

// Prisma Decimal 은 그대로 두면 프롬프트에 [object Object] 로 찍힌다. 결측은 null 로 보존해
// 렌더 쪽이 칸을 비울 수 있게 한다 — 0 으로 채우면 지수 결손 회차가 "초과수익 0%" 로 읽힌다.
const toRateOrNull = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value.toString());

@Injectable()
export class PaperTradingPrismaRepository implements PaperOrderLedgerPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadRecommendationScoreData(
    input: LoadRecommendationScoreDataInput,
  ): Promise<RecommendationScoreData> {
    const accounts = await this.prisma.paperAccount.findMany({
      where: { name: { in: ['LONG_TERM', 'SWING'] } },
      select: { id: true, name: true, seedAmount: true },
      orderBy: { id: 'asc' },
    });
    const accountIds = accounts.map((account) => account.id);
    const decidedAt = input.from
      ? { gte: input.from, lte: input.asOf }
      : { lte: input.asOf };
    const orders = await this.prisma.paperOrder.findMany({
      where: {
        accountId: { in: accountIds },
        side: 'BUY',
        strategy: { in: ['LONG_TERM', 'SWING'] },
        decidedAt,
      },
      select: {
        id: true,
        accountId: true,
        tickerId: true,
        side: true,
        strategy: true,
        status: true,
        quantity: true,
        ruleVersion: true,
      },
      orderBy: { id: 'asc' },
    });
    // 매도는 채점 대상이 아니지만(성적은 매수 사이클로 센다) 어떤 밴드가 그 사이클들을
    // 닫았는지는 성적을 읽는 전제다. 그래서 값만 따로 훑는다.
    //
    // 체결된 매도만 센다. 사이클을 닫는 것은 체결이므로, 대기·만료·취소된 주문의 밴드까지
    // 실으면 아직(또는 끝내) 아무 사이클도 닫지 않은 설정이 성적 표본을 닫은 것처럼 보인다 —
    // 밴드를 바꾼 직후 첫 주문이 대기 중일 때가 정확히 그 상황이다.
    const sellOrders = await this.prisma.paperOrder.findMany({
      where: {
        accountId: { in: accountIds },
        side: 'SELL',
        strategy: { in: ['LONG_TERM', 'SWING'] },
        status: { in: ['FILLED', 'PARTIALLY_FILLED'] },
        decidedAt,
      },
      select: {
        id: true,
        accountId: true,
        exitTakeProfitPercent: true,
        exitStopLossPercent: true,
      },
      orderBy: { id: 'asc' },
    });
    const orderIds = orders.map((order) => order.id);
    const buyTrades =
      orderIds.length === 0
        ? []
        : await this.prisma.paperTrade.findMany({
            where: {
              orderId: { in: orderIds },
              side: 'BUY',
              tradeDate: { lte: input.asOf },
            },
            select: {
              id: true,
              orderId: true,
              accountId: true,
              tickerId: true,
              side: true,
              quantity: true,
              price: true,
              fee: true,
              tax: true,
              realizedPnl: true,
              tradeDate: true,
            },
            orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
          });
    const earliestBuyTradeDate = buyTrades.reduce<Date | null>(
      (earliest, trade) =>
        earliest === null || trade.tradeDate < earliest
          ? trade.tradeDate
          : earliest,
      null,
    );
    const tickerIds = [...new Set(orders.map((order) => order.tickerId))];
    const sellTrades =
      earliestBuyTradeDate === null
        ? []
        : await this.prisma.paperTrade.findMany({
            where: {
              accountId: { in: accountIds },
              tickerId: { in: tickerIds },
              side: 'SELL',
              tradeDate: { gte: earliestBuyTradeDate, lte: input.asOf },
            },
            select: {
              id: true,
              orderId: true,
              accountId: true,
              tickerId: true,
              side: true,
              quantity: true,
              price: true,
              fee: true,
              tax: true,
              realizedPnl: true,
              tradeDate: true,
            },
            orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
          });
    const portfolioTradeDate = input.from
      ? { gte: input.from, lte: input.asOf }
      : { lte: input.asOf };
    const portfolioTrades = await this.prisma.paperTrade.findMany({
      where: {
        accountId: { in: accountIds },
        tradeDate: portfolioTradeDate,
      },
      select: {
        accountId: true,
        quantity: true,
        price: true,
        fee: true,
        tax: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
    });
    const priceDate = earliestBuyTradeDate
      ? { gte: earliestBuyTradeDate, lte: input.asOf }
      : null;
    const dailyPrices = priceDate
      ? await this.prisma.dailyPrice.findMany({
          where: { tickerId: { in: tickerIds }, tradeDate: priceDate },
          select: {
            tickerId: true,
            tradeDate: true,
            close: true,
            ticker: { select: { krxMarket: true } },
          },
          orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
        })
      : [];
    const benchmarkCloses = priceDate
      ? await this.prisma.benchmarkDailyClose.findMany({
          where: { symbol: 'KOSPI', tradeDate: priceDate },
          select: { tradeDate: true, close: true },
          orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
        })
      : [];
    const snapshotTradeDate = input.from
      ? { gte: input.from, lte: input.asOf }
      : { lte: input.asOf };
    const snapshots = await this.prisma.paperEquitySnapshot.findMany({
      where: {
        accountId: { in: accountIds },
        tradeDate: snapshotTradeDate,
        isBackfilled: false,
      },
      select: {
        accountId: true,
        tradeDate: true,
        totalValue: true,
        isBackfilled: true,
      },
      orderBy: [{ accountId: 'asc' }, { tradeDate: 'asc' }, { id: 'asc' }],
    });

    return {
      accounts: accounts.map((account) => ({
        ...account,
        name: account.name as Exclude<TradeStrategy, 'MANUAL'>,
      })),
      orders: orders.map((order) => ({
        ...order,
        side: order.side as TradeSide,
        strategy: order.strategy as TradeStrategy,
        status: order.status as OrderStatus,
      })),
      sellOrders: sellOrders.map((order) => ({
        id: order.id,
        accountId: order.accountId,
        takeProfitPercent: order.exitTakeProfitPercent?.toString() ?? null,
        stopLossPercent: order.exitStopLossPercent?.toString() ?? null,
      })),
      recommendationTrades: [...buyTrades, ...sellTrades]
        .sort((left, right) => {
          const dateDifference =
            left.tradeDate.getTime() - right.tradeDate.getTime();
          return dateDifference === 0 ? left.id - right.id : dateDifference;
        })
        .map((trade) => ({ ...trade, side: trade.side as TradeSide })),
      portfolioTrades,
      dailyPrices: dailyPrices.map((dailyPrice) => ({
        tickerId: dailyPrice.tickerId,
        market: dailyPrice.ticker.krxMarket as PaperMarket | null,
        tradeDate: dailyPrice.tradeDate,
        close: dailyPrice.close,
      })),
      benchmarkCloses,
      snapshots,
    };
  }

  // 같은 기준일을 다시 채점하면 덮어쓴다. 채점은 그날의 원장을 다시 읽어 계산하는
  // 순수 집계라 재실행 결과가 정본이고, 행이 쌓이면 어느 것이 정본인지 알 수 없게 된다.
  //
  // 구간 행(`periodInputs`)도 **같은 트랜잭션**에 넣는다. 나눠 쓰면 누적만 남고 구간이 빠진
  // 회차가 생기는데, 과거 기준일은 저장 자체를 건너뛰므로(usecase 의 `persisted` 조건) 그날
  // 구간 성적은 영구 결손이 된다. 밴드를 바꾼 전후를 갈라 보려고 만든 표라, 구멍 난 날이 곧
  // 판정할 수 없는 날이다.
  /**
   * 이 전략의 최신 채점 회차. 다음 추천 프롬프트에 실을 성적표 재료다.
   *
   * 계좌가 아니라 **전략**으로 묶는다 — 프롬프트를 받는 모델이 한 전략의 판단자다.
   *
   * 한 행이 계좌 개설 이후 누적이라 최신 한 건이 곧 전체 성적이다. 여러 건을 돌려주면
   * 호출부가 더하고 싶어지고, 더하는 순간 같은 청산이 두 번 세어진다.
   *
   * `asOfMax` 는 look-ahead 차단이다. 추천은 `decidedAt` 을 받아 과거 시점으로도 돌 수
   * 있는데, 상한이 없으면 그 시점 **이후** 성적이 프롬프트에 들어가 재현이 오염된다.
   */
  async findLatestRecommendationScore(input: {
    strategy: string;
    asOfMax: Date;
  }): Promise<RecommendationScoreSummary | null> {
    const row = await this.prisma.recommendationScore.findFirst({
      where: { strategy: input.strategy, asOf: { lte: input.asOfMax } },
      orderBy: { asOf: 'desc' },
      select: {
        asOf: true,
        closedCount: true,
        hitCount: true,
        meanReturnRate: true,
        meanExcessReturnRate: true,
        maximumLoss: true,
      },
    });
    if (row === null) {
      return null;
    }
    return {
      asOf: row.asOf,
      closedCount: row.closedCount,
      hitCount: row.hitCount,
      meanReturnRate: toRateOrNull(row.meanReturnRate),
      meanExcessReturnRate: toRateOrNull(row.meanExcessReturnRate),
      maximumLoss: toRateOrNull(row.maximumLoss),
    };
  }

  async saveRecommendationScores(
    inputs: SaveRecommendationScoreInput[],
    periodInputs: SaveRecommendationScorePeriodInput[] = [],
  ): Promise<void> {
    if (inputs.length === 0 && periodInputs.length === 0) {
      return;
    }
    await this.prisma.$transaction([
      // 구간 행은 **먼저 지우고 다시 넣는다**. 누적은 계좌·기준일당 한 행이라 upsert 로 늘 정본이
      // 되지만, 구간은 행 수가 실행마다 달라진다 — 매도 주문 상태나 밴드 값이 정정돼 어떤 구간이
      // 사라지면 upsert 만으로는 옛 행이 남는다. 그 유령 행은 "그 밴드로 청산한 적이 있다" 고
      // 주장하며 밴드별 판정에 섞이는데, 이 표를 만든 목적이 바로 그 판정이다.
      // 삭제 범위를 `periodInputs` 가 아니라 `inputs`(회차의 계좌 목록)에서 뽑는 이유: 이번 회차의
      // 구간이 0 개인 계좌도 옛 행을 지워야 정본이 된다.
      ...inputs.map((input) =>
        this.prisma.recommendationScorePeriod.deleteMany({
          where: { accountId: input.accountId, asOf: input.asOf },
        }),
      ),
      ...inputs.map((input) => {
        const values = {
          strategy: input.strategy,
          ruleVersions: input.ruleVersions,
          unknownRuleVersionCount: input.unknownRuleVersionCount,
          exitBands: input.exitBands,
          bandlessSellCount: input.bandlessSellCount,
          recommendationCount: input.recommendationCount,
          closedCount: input.closedCount,
          openCount: input.openCount,
          expiredCount: input.expiredCount,
          hitCount: input.hitCount,
          hitRate: input.hitRate,
          meanReturnRate: input.meanReturnRate,
          medianReturnRate: input.medianReturnRate,
          maximumLoss: input.maximumLoss,
          averageHoldingDays: input.averageHoldingDays,
          meanExcessReturnRate: input.meanExcessReturnRate,
          meanShadowReturnRate: input.meanShadowReturnRate,
          snapshotCount: input.snapshotCount,
          accountReturnRate: input.accountReturnRate,
          maximumDrawdown: input.maximumDrawdown,
          turnoverRate: input.turnoverRate,
          cumulativeCost: input.cumulativeCost,
          exclusions: input.exclusions,
        };
        return this.prisma.recommendationScore.upsert({
          where: {
            accountId_asOf: { accountId: input.accountId, asOf: input.asOf },
          },
          create: { accountId: input.accountId, asOf: input.asOf, ...values },
          update: values,
        });
      }),
      ...periodInputs.map((input) => {
        const values = {
          closedCount: input.closedCount,
          hitCount: input.hitCount,
          hitRate: input.hitRate,
          meanReturnRate: input.meanReturnRate,
          medianReturnRate: input.medianReturnRate,
          maximumLoss: input.maximumLoss,
          averageHoldingDays: input.averageHoldingDays,
        };
        return this.prisma.recommendationScorePeriod.upsert({
          where: {
            accountId_asOf_periodLabel_strategy: {
              accountId: input.accountId,
              asOf: input.asOf,
              periodLabel: input.periodLabel,
              strategy: input.strategy,
            },
          },
          create: {
            accountId: input.accountId,
            asOf: input.asOf,
            periodLabel: input.periodLabel,
            strategy: input.strategy,
            ...values,
          },
          update: values,
        });
      }),
    ]);
  }

  async findAccountByName(name: string): Promise<PaperAccountRecord | null> {
    return await this.prisma.paperAccount.findUnique({
      where: { name },
      select: { id: true, seedAmount: true, cashBalance: true },
    });
  }

  // 계좌 이름은 전략명이 그대로 쓰인다 (PAPER_RECOMMEND 의 findOrOpenAccount 가
  // LONG_TERM / SWING 으로 연다). 조회 쪽이 이름을 알고 있으면 전략이 늘 때마다
  // 조용히 빠지므로 전체를 이름순으로 훑는다.
  async findAllAccounts(): Promise<PaperAccountNamedRecord[]> {
    return await this.prisma.paperAccount.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, seedAmount: true, cashBalance: true },
    });
  }

  async createAccount(input: CreateAccountInput): Promise<{ id: number }> {
    try {
      return await this.prisma.paperAccount.create({
        data: {
          name: input.name,
          currency: input.currency,
          seedAmount: input.seedAmount.toString(),
          cashBalance: input.seedAmount.toString(),
          openedAt: input.openedAt,
        },
        select: { id: true },
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new Error(
          `같은 이름의 가상 매매 계좌가 이미 있습니다: ${input.name}`,
        );
      }
      throw error;
    }
  }

  async upsertKrTicker(input: {
    code: string;
    name?: string;
    market: PaperMarket;
  }): Promise<{ id: number }> {
    // PaperMarket은 세율 계산용 시장 구분이다. Ticker identity에 섞으면 같은 토스 종목이
    // KOSPI/KOSDAQ 행과 KR 행으로 갈라지므로 토스 국내 종목은 항상 KR/TOSS로 고정한다.
    return await this.prisma.ticker.upsert({
      where: { market_code: { market: 'KR', code: input.code } },
      create: {
        code: input.code,
        market: 'KR',
        marketCountry: 'KR',
        tossSymbol: input.code,
        name: input.name ?? input.code,
        currency: 'KRW',
        source: 'TOSS',
      },
      update: {
        marketCountry: 'KR',
        tossSymbol: input.code,
        ...(input.name === undefined ? {} : { name: input.name }),
        currency: 'KRW',
        source: 'TOSS',
      },
      select: { id: true },
    });
  }

  async findPosition(
    accountId: number,
    tickerId: number,
  ): Promise<PaperPositionRecord | null> {
    return await this.prisma.paperPosition.findUnique({
      where: { accountId_tickerId: { accountId, tickerId } },
      select: {
        id: true,
        accountId: true,
        tickerId: true,
        quantity: true,
        avgPrice: true,
      },
    });
  }

  async findPositionsWithTicker(
    accountId: number,
  ): Promise<PaperPositionWithTicker[]> {
    const positions = await this.prisma.paperPosition.findMany({
      where: {
        accountId,
        quantity: { gt: 0 },
        // source 는 행을 만든 경로를 적은 출처 딱지일 뿐이라 시세 조회 가능 여부와 무관하다.
        // 여기에 'TOSS' 를 걸면 유니버스(KRX 상장법인 목록, source='KRX')에서 고른 종목이
        // 통째로 빠져 보유가 0건으로 읽히고, 원장과 대조하는 불변식이 매번 깨진다.
        // 판별 축은 "토스로 시세를 뽑을 수 있는가" = tossSymbol 유무 하나면 충분하다.
        ticker: {
          market: 'KR',
          marketCountry: 'KR',
          tossSymbol: { not: null },
        },
      },
      include: { ticker: true },
      orderBy: { tickerId: 'asc' },
    });

    return positions.flatMap((position) => {
      if (!position.ticker.tossSymbol) {
        return [];
      }
      return [
        {
          id: position.id,
          accountId: position.accountId,
          tickerId: position.tickerId,
          quantity: position.quantity,
          avgPrice: position.avgPrice,
          ticker: {
            code: position.ticker.code,
            name: position.ticker.name,
            tossSymbol: position.ticker.tossSymbol,
          },
        },
      ];
    });
  }

  async applyTradeAtomically(
    input: ApplyTradeInput,
  ): Promise<ApplyTradeResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 모든 거래가 같은 계좌 행을 먼저 잠근 뒤 최신 현금·포지션을 읽는다. 계좌 단위로
        // 직렬화하므로 포지션 행이 아직 없는 동시 매수도 첫 transaction이 생성한 행을
        // 다음 transaction이 읽게 되어, 둘 다 null을 보고 한쪽 수량을 잃는 경합을 막는다.
        const account = await transaction.paperAccount.update({
          where: { id: input.accountId },
          data: { cashBalance: { increment: 0 } },
          select: { id: true, seedAmount: true, cashBalance: true },
        });
        const effectiveOrderId =
          input.orderId ??
          (
            await transaction.paperOrder.create({
              data: {
                accountId: input.accountId,
                tickerId: input.tickerId,
                side: input.side,
                quantity: input.quantity,
                strategy: input.strategy,
                reason: input.reason ?? null,
                decidedAt: new Date(),
                dataAsOf: input.tradeDate,
                targetTradeDate: input.tradeDate,
                status: 'FILLED',
                agentRunId: null,
              },
              select: { id: true },
            })
          ).id;
        // 자동 매매(3단계)는 먼저 만든 같은 orderId로 재시도하므로 fingerprint가 중복 체결을
        // 막는다. 수동 CLI는 호출마다 새 주문을 만들기 때문에 중복 입력을 막지 않으며,
        // 정당한 동일 조건 체결과 함께 사람이 status로 확인하는 영역으로 남긴다.
        const fingerprint = [
          input.accountId,
          input.tickerId,
          input.tradeDate.toISOString().slice(0, 10),
          input.side,
          input.quantity,
          input.price,
          effectiveOrderId,
        ].join(':');
        const duplicate = await transaction.paperTrade.findUnique({
          where: { fingerprint },
          select: { id: true },
        });
        if (duplicate) {
          throw new Error(
            '이미 기록된 가상 매매입니다. 중복 입력을 확인해 주세요.',
          );
        }
        const position = await transaction.paperPosition.findUnique({
          where: {
            accountId_tickerId: {
              accountId: input.accountId,
              tickerId: input.tickerId,
            },
          },
          select: {
            id: true,
            accountId: true,
            tickerId: true,
            quantity: true,
            avgPrice: true,
          },
        });
        const mutation = input.calculateMutation({ account, position });
        const trade = await transaction.paperTrade.create({
          data: {
            accountId: input.accountId,
            tickerId: input.tickerId,
            orderId: effectiveOrderId,
            side: input.side,
            quantity: input.quantity,
            price: input.price,
            fee: mutation.fee,
            tax: mutation.tax,
            realizedPnl: mutation.realizedPnl,
            tradeDate: input.tradeDate,
            fingerprint,
          },
          select: { id: true },
        });
        await transaction.paperPosition.upsert({
          where: {
            accountId_tickerId: {
              accountId: input.accountId,
              tickerId: input.tickerId,
            },
          },
          create: {
            accountId: input.accountId,
            tickerId: input.tickerId,
            quantity: mutation.positionQuantity,
            avgPrice: mutation.positionAvgPrice,
          },
          update: {
            quantity: mutation.positionQuantity,
            avgPrice: mutation.positionAvgPrice,
          },
        });
        await transaction.paperAccount.update({
          where: { id: input.accountId },
          data: { cashBalance: mutation.cashBalance },
        });
        return { tradeId: trade.id, ...mutation };
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new Error(
          '이미 기록된 가상 매매입니다. 중복 입력을 확인해 주세요.',
        );
      }
      throw error;
    }
  }

  async fillPendingOrderAtomically(
    input: FillPendingOrderInput,
  ): Promise<PendingOrderFillResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 수동 체결과 같은 계좌 lock 순서를 써서 최신 현금·보유량으로 수량을 확정한다.
        // 주문 상태 변경과 장부 반영도 이 transaction 안에서 끝내 부분 체결 상태를 막는다.
        const account = await transaction.paperAccount.update({
          where: { id: input.accountId },
          data: { cashBalance: { increment: 0 } },
          select: { id: true, seedAmount: true, cashBalance: true },
        });
        const order = await transaction.paperOrder.findUnique({
          where: { id: input.orderId },
          select: {
            status: true,
            accountId: true,
            tickerId: true,
            side: true,
            strategy: true,
          },
        });
        if (!order || order.status !== 'PENDING') {
          return { status: 'ALREADY_PROCESSED' as const };
        }
        if (
          order.accountId !== input.accountId ||
          order.tickerId !== input.tickerId ||
          order.side !== input.side ||
          order.strategy !== input.strategy
        ) {
          throw new Error(
            `자동 체결 주문 정보가 일치하지 않습니다: ${input.orderId}`,
          );
        }
        const position = await transaction.paperPosition.findUnique({
          where: {
            accountId_tickerId: {
              accountId: input.accountId,
              tickerId: input.tickerId,
            },
          },
          select: {
            id: true,
            accountId: true,
            tickerId: true,
            quantity: true,
            avgPrice: true,
          },
        });
        const decision = input.decide({ account, position });
        if (decision.status === 'EXPIRED') {
          const expired = await transaction.paperOrder.updateMany({
            where: { id: input.orderId, status: 'PENDING' },
            data: {
              status: 'EXPIRED',
              statusReason: decision.statusReason,
            },
          });
          if (expired.count === 0) {
            return { status: 'ALREADY_PROCESSED' as const };
          }
          return decision;
        }
        const claimed = await transaction.paperOrder.updateMany({
          where: { id: input.orderId, status: 'PENDING' },
          data: {
            quantity: decision.quantity,
            status: 'FILLED',
            statusReason: null,
          },
        });
        if (claimed.count === 0) {
          return { status: 'ALREADY_PROCESSED' as const };
        }
        const fingerprint = [
          input.accountId,
          input.tickerId,
          input.tradeDate.toISOString().slice(0, 10),
          input.side,
          decision.quantity,
          input.price,
          input.orderId,
        ].join(':');
        const duplicate = await transaction.paperTrade.findUnique({
          where: { fingerprint },
          select: { id: true },
        });
        if (duplicate) {
          throw new Error(
            '이미 기록된 가상 매매입니다. 중복 입력을 확인해 주세요.',
          );
        }
        await transaction.paperTrade.create({
          data: {
            accountId: input.accountId,
            tickerId: input.tickerId,
            orderId: input.orderId,
            side: input.side,
            quantity: decision.quantity,
            price: input.price,
            fee: decision.fee,
            tax: decision.tax,
            realizedPnl: decision.realizedPnl,
            tradeDate: input.tradeDate,
            fingerprint,
          },
        });
        await transaction.paperPosition.upsert({
          where: {
            accountId_tickerId: {
              accountId: input.accountId,
              tickerId: input.tickerId,
            },
          },
          create: {
            accountId: input.accountId,
            tickerId: input.tickerId,
            quantity: decision.positionQuantity,
            avgPrice: decision.positionAvgPrice,
          },
          update: {
            quantity: decision.positionQuantity,
            avgPrice: decision.positionAvgPrice,
          },
        });
        await transaction.paperAccount.update({
          where: { id: input.accountId },
          data: { cashBalance: decision.cashBalance },
        });
        return decision;
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new Error(
          '이미 기록된 가상 매매입니다. 중복 입력을 확인해 주세요.',
        );
      }
      throw error;
    }
  }

  async findTradesForInvariant(
    accountId: number,
  ): Promise<InvariantTradeRow[]> {
    const trades = await this.prisma.paperTrade.findMany({
      where: { accountId },
      select: {
        side: true,
        quantity: true,
        price: true,
        fee: true,
        tax: true,
        tickerId: true,
      },
      orderBy: { id: 'asc' },
    });
    return trades.map((trade) => ({
      ...trade,
      side: trade.side as TradeSide,
    }));
  }

  async upsertEquitySnapshot(
    input: UpsertSnapshotInput,
  ): Promise<{ snapshotId: number }> {
    return await this.prisma.$transaction(async (transaction) => {
      return await this.upsertEquitySnapshotWithClient(transaction, input);
    });
  }

  // 밴드 이탈 종목을 다음 거래일 시가 매도 주문으로 남긴다. 판정은 호출자가 평가
  // 결과로 하고, 수량은 여기서 원장의 현재 보유로 다시 맞춘다 — 판정과 주문 사이에
  // 체결이 끼어들면 보유보다 많은 수량을 팔려다 체결 단계에서 통째로 실패한다.
  async createExitBandOrders(
    input: CreateExitBandOrdersInput,
  ): Promise<CreateExitBandOrdersResult> {
    if (input.orders.length === 0) {
      return {
        created: 0,
        createdTickerIds: [],
        skippedByPendingSell: 0,
        skippedByNoPosition: 0,
      };
    }
    return await this.prisma.$transaction(async (transaction) => {
      await transaction.paperAccount.update({
        where: { id: input.accountId },
        data: { cashBalance: { increment: 0 } },
        select: { id: true },
      });
      const tickerIds = input.orders.map((order) => order.tickerId);
      const pendingSells = await transaction.paperOrder.findMany({
        where: {
          accountId: input.accountId,
          status: 'PENDING',
          side: 'SELL',
          tickerId: { in: tickerIds },
        },
        select: { tickerId: true },
      });
      const pendingSellTickerIds = new Set(
        pendingSells.map((order) => order.tickerId),
      );
      const positions = await transaction.paperPosition.findMany({
        where: {
          accountId: input.accountId,
          tickerId: { in: tickerIds },
          quantity: { gt: 0 },
        },
        select: { tickerId: true, quantity: true },
      });
      const quantityByTickerId = new Map(
        positions.map((position) => [
          position.tickerId,
          position.quantity.toString(),
        ]),
      );

      let skippedByPendingSell = 0;
      let skippedByNoPosition = 0;
      const data = input.orders.flatMap((order) => {
        if (pendingSellTickerIds.has(order.tickerId)) {
          skippedByPendingSell += 1;
          return [];
        }
        const quantity = quantityByTickerId.get(order.tickerId);
        if (quantity === undefined) {
          skippedByNoPosition += 1;
          return [];
        }
        return [
          {
            accountId: input.accountId,
            tickerId: order.tickerId,
            side: 'SELL',
            quantity,
            strategy: input.strategy,
            reason: order.reason,
            decidedAt: input.decidedAt,
            dataAsOf: input.dataAsOf,
            targetTradeDate: input.targetTradeDate,
            status: 'PENDING',
            agentRunId: input.agentRunId,
            exitTakeProfitPercent: input.threshold.takeProfitPercent,
            exitStopLossPercent: input.threshold.stopLossPercent,
          },
        ];
      });
      if (data.length > 0) {
        await transaction.paperOrder.createMany({ data });
      }
      return {
        created: data.length,
        createdTickerIds: data.map((order) => order.tickerId),
        skippedByPendingSell,
        skippedByNoPosition,
      };
    });
  }

  async saveEquitySnapshotWithRevalidatedState<T>(
    accountId: number,
    decide: (state: RevalidatedPaperAccountState) => SnapshotDecision<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(async (transaction) => {
      // 거래 경로와 같은 계좌 행을 먼저 잠가 재검증 직후 체결이 끼어드는 TOCTOU를 막는다.
      // 시세 네트워크 호출은 이 메서드 전에 끝나므로 DB 연결을 기다리는 동안 잡지 않는다.
      const account = await transaction.paperAccount.update({
        where: { id: accountId },
        data: { cashBalance: { increment: 0 } },
        select: { id: true, seedAmount: true, cashBalance: true },
      });
      const positions = await transaction.paperPosition.findMany({
        where: {
          accountId,
          quantity: { gt: 0 },
          // findPositionsWithTicker 와 같은 조건이어야 한다. 한쪽만 좁으면 재검증이
          // "평가한 보유"와 다른 집합을 보고 불변식을 판정한다.
          ticker: {
            market: 'KR',
            marketCountry: 'KR',
            tossSymbol: { not: null },
          },
        },
        include: { ticker: true },
        orderBy: { tickerId: 'asc' },
      });
      const trades = await transaction.paperTrade.findMany({
        where: { accountId },
        select: {
          side: true,
          quantity: true,
          price: true,
          fee: true,
          tax: true,
          tickerId: true,
        },
        orderBy: { id: 'asc' },
      });
      const decision = decide({
        account,
        positions: positions.flatMap((position) => {
          if (!position.ticker.tossSymbol) {
            return [];
          }
          return [
            {
              id: position.id,
              accountId: position.accountId,
              tickerId: position.tickerId,
              quantity: position.quantity,
              avgPrice: position.avgPrice,
              ticker: {
                code: position.ticker.code,
                name: position.ticker.name,
                tossSymbol: position.ticker.tossSymbol,
              },
            },
          ];
        }),
        trades: trades.map((trade) => ({
          ...trade,
          side: trade.side as TradeSide,
        })),
      });
      if (decision.snapshot) {
        await this.upsertEquitySnapshotWithClient(
          transaction,
          decision.snapshot,
        );
      }
      return decision.result;
    });
  }

  private async upsertEquitySnapshotWithClient(
    transaction: Prisma.TransactionClient,
    input: UpsertSnapshotInput,
  ): Promise<{ snapshotId: number }> {
    const snapshot = await transaction.paperEquitySnapshot.upsert({
      where: {
        accountId_tradeDate: {
          accountId: input.accountId,
          tradeDate: input.tradeDate,
        },
      },
      create: {
        accountId: input.accountId,
        tradeDate: input.tradeDate,
        cashBalance: input.cashBalance,
        positionValue: input.positionValue,
        totalValue: input.totalValue,
        returnRate: input.returnRate,
        staleTickerCount: input.staleTickerCount,
        benchmarkClose: input.benchmarkClose ?? null,
        isBackfilled: false,
      },
      update: {
        cashBalance: input.cashBalance,
        positionValue: input.positionValue,
        totalValue: input.totalValue,
        returnRate: input.returnRate,
        staleTickerCount: input.staleTickerCount,
        benchmarkClose: input.benchmarkClose ?? null,
        isBackfilled: false,
      },
      select: { id: true },
    });

    // 같은 날짜 재평가는 총계와 종목별 근거가 한 시점의 값이어야 한다. 기존 종목별 행을
    // 같은 transaction에서 지우고 다시 써야 중간 실패가 총계만 갱신된 상태를 남기지 않는다.
    await transaction.paperPositionSnapshot.deleteMany({
      where: { snapshotId: snapshot.id },
    });
    if (input.positions.length > 0) {
      await transaction.paperPositionSnapshot.createMany({
        data: input.positions.map((position) => ({
          snapshotId: snapshot.id,
          ...position,
        })),
      });
    }
    return { snapshotId: snapshot.id };
  }

  async findRecentSnapshots(
    accountId: number,
    limit: number,
  ): Promise<SnapshotRow[]> {
    return await this.prisma.paperEquitySnapshot.findMany({
      where: { accountId },
      orderBy: { tradeDate: 'desc' },
      take: limit,
      select: {
        id: true,
        tradeDate: true,
        totalValue: true,
        returnRate: true,
      },
    });
  }

  async findLatestValuation(accountId: number): Promise<SnapshotRow | null> {
    return await this.prisma.paperEquitySnapshot.findFirst({
      where: { accountId },
      orderBy: { tradeDate: 'desc' },
      select: {
        id: true,
        tradeDate: true,
        totalValue: true,
        returnRate: true,
      },
    });
  }

  async saveRecommendationAtomically<T>(input: {
    accountId: number;
    strategy: Exclude<TradeStrategy, 'MANUAL'>;
    decidedAt: Date;
    decide: (
      state: LockedPaperRecommendationState,
    ) => PaperRecommendationSaveDecision<T>;
  }): Promise<T> {
    return await this.prisma.$transaction(async (transaction) => {
      // 모델 호출 뒤 계좌 행을 먼저 잠그고 모든 제약 입력을 다시 읽는다. 이 잠금은 같은
      // account의 동시 추천을 serialize해 identity 검사와 주문 생성 사이의 race도 닫는다.
      const account = await transaction.paperAccount.update({
        where: { id: input.accountId },
        data: { cashBalance: { increment: 0 } },
        select: { id: true, seedAmount: true, cashBalance: true },
      });
      const duplicate = await transaction.paperOrder.findFirst({
        where: {
          accountId: input.accountId,
          strategy: input.strategy,
          decidedAt: input.decidedAt,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new Error('이미 저장된 모의투자 추천입니다.');
      }
      const [positions, latestValuation, existingOrders] = await Promise.all([
        transaction.paperPosition.findMany({
          where: { accountId: input.accountId, quantity: { gt: 0 } },
          include: { ticker: true },
          orderBy: { tickerId: 'asc' },
        }),
        transaction.paperEquitySnapshot.findFirst({
          where: { accountId: input.accountId },
          orderBy: { tradeDate: 'desc' },
          select: {
            id: true,
            tradeDate: true,
            totalValue: true,
            returnRate: true,
          },
        }),
        transaction.paperOrder.findMany({
          where: { accountId: input.accountId, status: 'PENDING' },
          select: {
            tickerId: true,
            side: true,
            quantity: true,
            indicatorSnapshot: true,
          },
          orderBy: { id: 'asc' },
        }),
      ]);
      const decision = input.decide({
        account,
        positions: positions.flatMap((position) => {
          if (!position.ticker.tossSymbol) {
            return [];
          }
          return [
            {
              id: position.id,
              accountId: position.accountId,
              tickerId: position.tickerId,
              quantity: position.quantity,
              avgPrice: position.avgPrice,
              ticker: {
                code: position.ticker.code,
                name: position.ticker.name,
                tossSymbol: position.ticker.tossSymbol,
              },
            },
          ];
        }),
        latestValuation,
        existingOrders,
      });
      if (decision.orders.length === 0) {
        return decision.result;
      }
      await transaction.paperOrder.createMany({
        data: decision.orders.map((order) => ({
          accountId: input.accountId,
          tickerId: order.tickerId,
          side: order.side,
          quantity: order.quantity,
          strategy: order.strategy,
          reason: order.reason,
          decidedAt: order.decidedAt,
          dataAsOf: order.dataAsOf,
          targetTradeDate: order.targetTradeDate,
          status: order.status,
          indicatorSnapshot:
            order.indicatorSnapshot === null
              ? Prisma.JsonNull
              : (order.indicatorSnapshot as Prisma.InputJsonValue),
          ruleVersion: order.ruleVersion,
          agentRunId: order.agentRunId,
        })),
      });
      return decision.result;
    });
  }

  async hasOrdersForRecommendation(input: {
    accountId: number;
    strategy: Exclude<TradeStrategy, 'MANUAL'>;
    decidedAt: Date;
  }): Promise<boolean> {
    const order = await this.prisma.paperOrder.findFirst({
      where: input,
      select: { id: true },
    });
    return order !== null;
  }

  async findDuePendingOrders(tradeDate: Date): Promise<DuePaperOrderRecord[]> {
    const orders = await this.prisma.paperOrder.findMany({
      where: {
        status: 'PENDING',
        targetTradeDate: { lte: tradeDate },
      },
      include: { account: true, ticker: true },
      orderBy: { id: 'asc' },
    });
    return orders.flatMap((order) => {
      if (!order.targetTradeDate || !order.ticker.tossSymbol) {
        return [];
      }
      return [
        {
          id: order.id,
          accountId: order.accountId,
          accountName: order.account.name,
          tickerId: order.tickerId,
          tickerCode: order.ticker.code,
          tickerName: order.ticker.name,
          tossSymbol: order.ticker.tossSymbol,
          krxMarket: order.ticker.krxMarket,
          side: order.side as TradeSide,
          quantity: order.quantity,
          strategy: order.strategy as Exclude<TradeStrategy, 'MANUAL'>,
          reason: order.reason,
          targetTradeDate: order.targetTradeDate,
        },
      ];
    });
  }

  async expirePendingOrder(
    orderId: number,
    statusReason: string,
  ): Promise<boolean> {
    const result = await this.prisma.paperOrder.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'EXPIRED', statusReason },
    });
    return result.count === 1;
  }

  async expireDuePendingOrders(
    tradeDate: Date,
    statusReason: string,
  ): Promise<{ attempted: number; expired: number }> {
    const where: Prisma.PaperOrderWhereInput = {
      status: 'PENDING',
      targetTradeDate: { lte: tradeDate },
    };
    const attempted = await this.prisma.paperOrder.count({ where });
    const result = await this.prisma.paperOrder.updateMany({
      where,
      data: { status: 'EXPIRED', statusReason },
    });
    return { attempted, expired: result.count };
  }

  async findLatestSnapshotBefore(
    accountId: number,
    tradeDate: Date,
  ): Promise<SnapshotRow | null> {
    return await this.prisma.paperEquitySnapshot.findFirst({
      where: { accountId, tradeDate: { lt: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: {
        id: true,
        tradeDate: true,
        totalValue: true,
        returnRate: true,
      },
    });
  }
}
