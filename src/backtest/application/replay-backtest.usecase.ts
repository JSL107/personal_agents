import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { constrainPaperRecommendation } from '../../agent/paper-recommend/domain/paper-recommendation.constraint';
import { planPendingOrders } from '../../agent/paper-recommend/domain/pending-order-plan';
import { calculateIndicators } from '../../market-data/domain/stock-indicator';
import { ExecutePaperOrderUsecase } from '../../paper-trading/application/execute-paper-order.usecase';
import {
  decideExitBandOrders,
  ExitBandCandidate,
  ExitBandThreshold,
} from '../../paper-trading/domain/exit-band';
import { PaperMarket } from '../../paper-trading/domain/paper-account.type';
import { verifyPaperInvariants } from '../../paper-trading/domain/paper-invariant';
import { calculatePositionValuation } from '../../paper-trading/domain/paper-valuation';
import {
  aggregateRecommendationScores,
  matchRecommendationCycles,
  StrategyRecommendationScore,
} from '../../paper-trading/domain/recommendation-score';
import {
  BenchmarkCloseInput,
  calculateBenchmarkPerformance,
  ShadowDailyPriceInput,
} from '../../paper-trading/domain/shadow-performance';
import {
  ScreenCandidate,
  SCREENER_RULE_VERSION,
  screenStocks,
  ScreenStrategy,
} from '../../screener/domain/screener-rule';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';
import { buildBacktestCalendar } from '../domain/backtest-calendar';
import {
  BacktestExpirationRecord,
  BacktestFillRecord,
  BacktestMetricSummary,
  summarizeBacktestMetrics,
} from '../domain/backtest-metric';
import { selectDeterministicRecommendation } from '../domain/top-scored-selection';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { InMemoryPaperLedger } from '../infrastructure/in-memory-paper-ledger';

// 지표는 최대 200봉을 본다. 재생 시작일보다 이만큼 앞선 봉을 미리 읽어야 첫날부터
// ma120·200일 고점이 계산된다. 200거래일은 약 290일이므로 휴장 여유를 포함해 400일 앞당긴다.
const WARMUP_CALENDAR_DAYS = 400;
const INDICATOR_BAR_LIMIT = 200;

export interface ReplayBacktestCommand {
  strategy: ScreenStrategy;
  from: string;
  to: string;
  seedAmount: string;
  minimumTurnover60: number;
  maximumPositions: number;
  weightPercent: number;
  holdingTradeDays: number;
  exitBand: ExitBandThreshold | null;
}

export interface ReplayBacktestResult {
  strategy: ScreenStrategy;
  from: string;
  to: string;
  tradeDateCount: number;
  orderCount: number;
  filledCount: number;
  expiredCount: number;
  missingOpenCount: number;
  finalCashBalance: string;
  finalTotalValue: string | null;
  finalReturnRate: string | null;
  scores: StrategyRecommendationScore[];
  // 코스피 대비 평균 초과수익. 벤치마크 종가가 없으면 null 이다.
  meanExcessReturnRate: string | null;
  benchmarkUnavailableCount: number;
  exitBand: ExitBandThreshold | null;
  exitBandSellCounts: { takeProfit: number; stopLoss: number };
  // 채점기가 센 원장 이상을 유형별로 나눈 것. 건수만 찍으면 "무엇이" 이상인지 알 수 없어
  // 성적을 믿을지 판단할 수 없다 — 밴드를 태우면 매도가 늘어 이 분포가 달라진다.
  anomaliesByType: Record<string, number>;
  metrics: BacktestMetricSummary;
  invariantViolations: string[];
}

interface BenchmarkOutcome {
  meanExcessReturnRate: string | null;
  benchmarkUnavailableCount: number;
}

interface PendingOrder {
  orderId: number;
  tickerId: number;
  side: 'BUY' | 'SELL';
  quantity: number;
  targetTradeDate: string;
  // 주문 시점 종가. 예약 현금은 planPendingOrders 가 여기서 계산한다 — 금액을 미리
  // 접어 두면 "수량 x 종가" 규칙이 실전과 백테스트에 각각 남는다.
  close: number | null;
}

interface ReplayState {
  pendingOrders: PendingOrder[];
  nextOrderId: number;
  missingOpenCount: number;
  filledCount: number;
  expiredCount: number;
  exitBandSells: { TAKE_PROFIT: number; STOP_LOSS: number };
}

const dateTextOf = (value: Date): string => value.toISOString().slice(0, 10);

const countAnomaliesByType = (
  anomalies: ReturnType<typeof matchRecommendationCycles>['anomalies'],
): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const anomaly of anomalies) {
    counts[anomaly.type] = (counts[anomaly.type] ?? 0) + 1;
  }
  return counts;
};

const nextWeekdayText = (dateText: string): string => {
  const cursor = new Date(`${dateText}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dateTextOf(cursor);
};

@Injectable()
export class ReplayBacktestUsecase {
  constructor(private readonly repository: BacktestPrismaRepository) {}

  async execute(command: ReplayBacktestCommand): Promise<ReplayBacktestResult> {
    const tickers = await this.repository.findUniverse();
    const barsByTicker = await this.repository.findBarsInRange(
      tickers.map((ticker) => ticker.tickerId),
      this.warmupFrom(command.from),
      new Date(`${command.to}T00:00:00.000Z`),
    );
    const tickerById = new Map(
      tickers.map((ticker) => [ticker.tickerId, ticker]),
    );
    const calendar = buildBacktestCalendar({
      from: command.from,
      to: command.to,
      tradeDates: this.collectTradeDates(barsByTicker),
    });
    const tradeDateIndex = new Map(
      calendar.tradeDates.map((value, index) => [value, index]),
    );
    const recommendDates = new Set(calendar.recommendDates);

    const ledger = new InMemoryPaperLedger(command.seedAmount);
    // 체결 규칙은 실전과 같은 한 벌을 쓰고, 원장만 메모리 구현으로 갈아끼운다.
    const executeOrder = new ExecutePaperOrderUsecase(ledger);
    const fills: BacktestFillRecord[] = [];
    const expirations: BacktestExpirationRecord[] = [];
    const entryIndexByTicker = new Map<number, number>();
    const state: ReplayState = {
      pendingOrders: [],
      nextOrderId: 1,
      missingOpenCount: 0,
      filledCount: 0,
      expiredCount: 0,
      exitBandSells: { TAKE_PROFIT: 0, STOP_LOSS: 0 },
    };

    const allDates = [
      ...new Set([...calendar.recommendDates, ...calendar.tradeDates]),
    ].sort();

    for (const today of allDates) {
      // 하루 순서는 체결(시가) → 밴드 판정(종가) → 추천이다. 운영에서 장마감 평가·밴드가
      // 19:30 추천보다 먼저 도는 것과 같고, 밴드는 종가가 있는 거래일에만 판정한다.
      if (tradeDateIndex.has(today)) {
        await this.fillDueOrders({
          today,
          command,
          barsByTicker,
          tickerById,
          tradeDateIndex,
          ledger,
          executeOrder,
          fills,
          expirations,
          entryIndexByTicker,
          state,
        });
        this.applyExitBand({
          today,
          command,
          barsByTicker,
          tickerById,
          tradeDates: calendar.tradeDates,
          ledger,
          state,
        });
      }
      if (recommendDates.has(today)) {
        this.placeOrders({
          today,
          command,
          barsByTicker,
          tickerById,
          tickers,
          tradeDates: calendar.tradeDates,
          tradeDateIndex,
          ledger,
          entryIndexByTicker,
          state,
        });
      }
    }

    const benchmarkCloses = await this.repository.findBenchmarkCloses(
      new Date(`${command.from}T00:00:00.000Z`),
      new Date(`${command.to}T00:00:00.000Z`),
    );

    return this.buildResult({
      command,
      calendar,
      ledger,
      barsByTicker,
      tickerById,
      benchmarkCloses,
      fills,
      expirations,
      state,
    });
  }

  private warmupFrom(from: string): Date {
    const warmup = new Date(`${from}T00:00:00.000Z`);
    warmup.setUTCDate(warmup.getUTCDate() - WARMUP_CALENDAR_DAYS);
    return warmup;
  }

  private collectTradeDates(
    barsByTicker: Map<number, BacktestBar[]>,
  ): string[] {
    const tradeDates = new Set<string>();
    for (const bars of barsByTicker.values()) {
      for (const bar of bars) {
        tradeDates.add(dateTextOf(bar.tradeDate));
      }
    }
    return [...tradeDates];
  }

  private async fillDueOrders(context: {
    today: string;
    command: ReplayBacktestCommand;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    tradeDateIndex: Map<string, number>;
    ledger: InMemoryPaperLedger;
    executeOrder: ExecutePaperOrderUsecase;
    fills: BacktestFillRecord[];
    expirations: BacktestExpirationRecord[];
    entryIndexByTicker: Map<number, number>;
    state: ReplayState;
  }): Promise<void> {
    const stillPending: PendingOrder[] = [];
    for (const order of context.state.pendingOrders) {
      if (order.targetTradeDate > context.today) {
        stillPending.push(order);
        continue;
      }
      const bar = this.findBar(
        context.barsByTicker,
        order.tickerId,
        context.today,
      );
      const ticker = context.tickerById.get(order.tickerId);
      // 시가가 없으면 체결가를 만들 수 없다. 조용히 넘기면 표본이 줄어든 줄 모른 채
      // 성적만 좋아 보이므로 만료로 세고 사유를 남긴다.
      if (!bar || bar.open === null || !ticker) {
        context.state.missingOpenCount += 1;
        context.state.expiredCount += 1;
        context.expirations.push({
          tradeDate: context.today,
          statusReason: '시가 없음',
        });
        context.ledger.markOrderStatus(order.orderId, 'EXPIRED');
        continue;
      }
      const valuationBefore = this.valuate(
        context.ledger,
        context.barsByTicker,
        context.today,
      );
      const fill = await context.executeOrder.execute({
        orderId: order.orderId,
        accountId: context.ledger.accountId,
        tickerId: order.tickerId,
        market: ticker.krxMarket as PaperMarket,
        side: order.side,
        requestedQuantity: String(order.quantity),
        price: String(bar.open),
        tradeDate: context.today,
        strategy: context.command.strategy,
      });
      if (fill.status === 'FILLED') {
        context.state.filledCount += 1;
        context.fills.push({
          tradeDate: context.today,
          filledAmount: Number(fill.quantity) * bar.open,
          accountValuation: valuationBefore,
        });
        if (order.side === 'BUY') {
          context.entryIndexByTicker.set(
            order.tickerId,
            context.tradeDateIndex.get(context.today) as number,
          );
        } else {
          context.entryIndexByTicker.delete(order.tickerId);
        }
      } else if (fill.status === 'EXPIRED') {
        context.state.expiredCount += 1;
        context.expirations.push({
          tradeDate: context.today,
          statusReason: fill.statusReason,
        });
      }
    }
    context.state.pendingOrders = stillPending;
  }

  private applyExitBand(context: {
    today: string;
    command: ReplayBacktestCommand;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    tradeDates: string[];
    ledger: InMemoryPaperLedger;
    state: ReplayState;
  }): void {
    if (context.command.exitBand === null) {
      return;
    }
    const targetTradeDate = nextWeekdayText(context.today);
    // 체결될 거래일이 구간 안에 없으면 그 주문은 영원히 PENDING 으로 남는다. placeOrders 가
    // 같은 이유로 같은 가드를 쓴다.
    if (!this.hasTradeDateAfter(context.tradeDates, context.today)) {
      return;
    }
    // 이미 대기 매도가 있는 종목은 건너뛴다. 보유는 체결 전까지 남아 있으므로 이 가드가
    // 없으면 같은 종목에 매도가 매일 겹겹이 쌓인다. 운영도 pending SELL 만 보고 pending BUY
    // 는 보지 않는다 (createExitBandOrders).
    const pendingSellTickerIds = new Set(
      context.state.pendingOrders
        .filter((order) => order.side === 'SELL')
        .map((order) => order.tickerId),
    );
    const candidates: ExitBandCandidate[] = [];
    for (const position of context.ledger.openPositions()) {
      if (pendingSellTickerIds.has(position.tickerId)) {
        continue;
      }
      const ticker = context.tickerById.get(position.tickerId);
      if (ticker === undefined) {
        continue;
      }
      const bars = (context.barsByTicker.get(position.tickerId) ?? []).filter(
        (bar) => dateTextOf(bar.tradeDate) <= context.today,
      );
      const latest = bars.at(-1);
      if (latest === undefined) {
        continue;
      }
      // 손익률은 운영 평가와 같은 함수로 낸다. 마지막 봉이 오늘이 아니면 그 값은
      // isStale 로 표시되고 밴드 판정에서 빠진다 — 낡은 시세로 손절하면 그 뒤 반등을
      // 못 본 채 파는 것이라 운영도 같은 기준으로 넘긴다.
      const valuation = calculatePositionValuation(
        {
          tickerId: position.tickerId,
          quantity: position.quantity,
          avgPrice: position.avgPrice,
          price: new Prisma.Decimal(latest.close.toString()),
          priceDate: latest.tradeDate,
        },
        new Date(`${context.today}T00:00:00.000Z`),
      );
      candidates.push({
        tickerId: position.tickerId,
        tickerCode: ticker.code,
        quantity: position.quantity.toString(),
        returnRate: valuation.returnRate,
        isStale: valuation.isStale,
      });
    }

    const decisions = decideExitBandOrders(
      candidates,
      context.command.exitBand,
    );
    for (const decision of decisions) {
      context.ledger.recordOrder({
        id: context.state.nextOrderId,
        accountId: context.ledger.accountId,
        tickerId: decision.tickerId,
        side: 'SELL',
        strategy: context.command.strategy,
        status: 'PENDING',
        quantity: new Prisma.Decimal(decision.quantity),
        // 밴드 매도는 스크리너 규칙의 산물이 아니다. 운영 원장도 이 주문에 규칙 버전을
        // 남기지 않으므로 같은 값을 쓴다 — 채점은 매수 주문만 사이클로 센다.
        ruleVersion: null,
      });
      context.state.pendingOrders.push({
        orderId: context.state.nextOrderId,
        tickerId: decision.tickerId,
        side: 'SELL',
        quantity: Number(decision.quantity),
        targetTradeDate,
        // 매도는 현금을 예약하지 않는다 (planPendingOrders 는 매수만 예약에 센다).
        close: null,
      });
      context.state.exitBandSells[decision.reason] += 1;
      context.state.nextOrderId += 1;
    }
  }

  private placeOrders(context: {
    today: string;
    command: ReplayBacktestCommand;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    tickers: BacktestTicker[];
    tradeDates: string[];
    tradeDateIndex: Map<string, number>;
    ledger: InMemoryPaperLedger;
    entryIndexByTicker: Map<number, number>;
    state: ReplayState;
  }): void {
    const targetTradeDate = nextWeekdayText(context.today);
    // 체결될 거래일이 구간 안에 없으면 그 주문은 영원히 PENDING 으로 남는다. 채점기는 이를
    // UNEXPECTED_ORDER_STATUS 이상으로 세고 주문 수도 부풀리므로 아예 만들지 않는다.
    if (!this.hasTradeDateAfter(context.tradeDates, context.today)) {
      return;
    }
    // 추천은 평일마다 돌지만 판단 근거는 마지막으로 마감된 거래일 종가다.
    // 실전 크론이 19:30 에 최신 종가로 판단하는 것과 같다.
    const asOf = this.latestTradeDateOnOrBefore(
      context.tradeDates,
      context.today,
    );
    if (asOf === null) {
      return;
    }
    const candidates = this.buildCandidates(
      context.tickers,
      context.barsByTicker,
      asOf,
    );
    const ranked = screenStocks(
      candidates,
      context.command.strategy,
      candidates.length,
      context.command.minimumTurnover60,
    );
    const asOfIndex = context.tradeDateIndex.get(asOf) as number;
    const heldPositions = context.ledger.openPositions().map((position) => ({
      code: context.tickerById.get(position.tickerId)?.code ?? '',
      holdingTradeDays:
        asOfIndex -
        (context.entryIndexByTicker.get(position.tickerId) ?? asOfIndex),
    }));
    const plan = planPendingOrders({
      pendingOrders: context.state.pendingOrders,
      cashBalance: Number(context.ledger.cashBalance.toString()),
      codeOf: (tickerId) => context.tickerById.get(tickerId)?.code,
    });
    const recommendation = selectDeterministicRecommendation({
      rankedStocks: ranked.map((stock) => ({
        tickerId: stock.tickerId,
        code: stock.code,
        name: stock.name,
        score: stock.score,
      })),
      heldPositions,
      maximumPositions: context.command.maximumPositions,
      holdingTradeDays: context.command.holdingTradeDays,
      pendingBuyCodes: plan.pendingBuyCodes,
    });
    const accountValuation = this.valuate(
      context.ledger,
      context.barsByTicker,
      asOf,
    );
    const constrained = constrainPaperRecommendation({
      recommendation,
      candidates: ranked.map((stock) => ({
        tickerId: stock.tickerId,
        code: stock.code,
        name: stock.name,
        close: stock.indicators.close,
      })),
      positions: context.ledger.openPositions().map((position) => ({
        tickerId: position.tickerId,
        code: context.tickerById.get(position.tickerId)?.code ?? '',
        quantity: Number(position.quantity.toString()),
      })),
      cashBalance: plan.availableCash,
      accountValuation,
      // CLI 의 --weight 를 그대로 쓴다. 이 값을 넘기지 않으면 운영 상수 20% 가 적용돼
      // --weight 30 이 실제로는 20% 만 매수하면서 30% 규칙의 성적으로 표시된다.
      maximumWeightPercent: context.command.weightPercent,
    });

    // 같은 종목에 대기 주문이 이미 있으면 새로 만들지 않는다 — 없으면 연휴 동안 같은 종목
    // 주문이 겹겹이 쌓인다. 이번 회차에 만든 주문도 뒤 항목을 막아야 하므로, 읽기 전용인
    // 도메인 계획의 집합을 복사해 루프에서 갱신한다.
    const pendingTickerIds = new Set(plan.pendingTickerIds);
    const closeByTickerId = new Map(
      ranked.map((stock) => [stock.tickerId, stock.indicators.close]),
    );
    for (const intent of [...constrained.sells, ...constrained.buys]) {
      if (pendingTickerIds.has(intent.tickerId)) {
        continue;
      }
      context.ledger.recordOrder({
        id: context.state.nextOrderId,
        accountId: context.ledger.accountId,
        tickerId: intent.tickerId,
        side: intent.side,
        strategy: context.command.strategy,
        status: 'PENDING',
        quantity: new Prisma.Decimal(intent.quantity),
        ruleVersion: SCREENER_RULE_VERSION,
      });
      context.state.pendingOrders.push({
        orderId: context.state.nextOrderId,
        tickerId: intent.tickerId,
        side: intent.side,
        quantity: intent.quantity,
        targetTradeDate,
        close: closeByTickerId.get(intent.tickerId) ?? null,
      });
      pendingTickerIds.add(intent.tickerId);
      context.state.nextOrderId += 1;
    }
  }

  private buildResult(context: {
    command: ReplayBacktestCommand;
    calendar: { tradeDates: string[] };
    ledger: InMemoryPaperLedger;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    benchmarkCloses: BenchmarkCloseInput[];
    fills: BacktestFillRecord[];
    expirations: BacktestExpirationRecord[];
    state: ReplayState;
  }): ReplayBacktestResult {
    const lastTradeDate = context.calendar.tradeDates.at(-1) ?? null;
    const finalTotalValue =
      lastTradeDate === null
        ? null
        : this.valuate(context.ledger, context.barsByTicker, lastTradeDate);
    const violations = verifyPaperInvariants({
      seedAmount: context.ledger.seedAmount,
      cashBalance: context.ledger.cashBalance,
      trades: context.ledger.trades.map((trade) => ({
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee,
        tax: trade.tax,
        tickerId: trade.tickerId,
      })),
      positions: context.ledger.openPositions().map((position) => ({
        tickerId: position.tickerId,
        quantity: position.quantity,
      })),
    });
    const matched = matchRecommendationCycles({
      orders: context.ledger.orders,
      trades: context.ledger.trades,
    });
    const benchmark = this.evaluateBenchmark({
      command: context.command,
      matched,
      barsByTicker: context.barsByTicker,
      tickerById: context.tickerById,
      benchmarkCloses: context.benchmarkCloses,
      lastTradeDate,
    });
    const seedAmount = Number(context.ledger.seedAmount.toString());

    return {
      strategy: context.command.strategy,
      from: context.command.from,
      to: context.command.to,
      tradeDateCount: context.calendar.tradeDates.length,
      orderCount: context.ledger.orders.length,
      filledCount: context.state.filledCount,
      expiredCount: context.state.expiredCount,
      missingOpenCount: context.state.missingOpenCount,
      finalCashBalance: context.ledger.cashBalance.toString(),
      finalTotalValue:
        finalTotalValue === null ? null : String(finalTotalValue),
      finalReturnRate:
        finalTotalValue === null || seedAmount === 0
          ? null
          : String(finalTotalValue / seedAmount - 1),
      scores: aggregateRecommendationScores(matched),
      meanExcessReturnRate: benchmark.meanExcessReturnRate,
      benchmarkUnavailableCount: benchmark.benchmarkUnavailableCount,
      exitBand: context.command.exitBand,
      exitBandSellCounts: {
        takeProfit: context.state.exitBandSells.TAKE_PROFIT,
        stopLoss: context.state.exitBandSells.STOP_LOSS,
      },
      anomaliesByType: countAnomaliesByType(matched.anomalies),
      metrics: summarizeBacktestMetrics({
        fills: context.fills,
        expirations: context.expirations,
        targetWeightPercent: context.command.weightPercent,
        maximumPositions: context.command.maximumPositions,
      }),
      invariantViolations: violations.map((violation) => violation.detail),
    };
  }

  // 코스피 대비 초과수익은 실전 성적표와 같은 함수로 잰다. 벤치마크 종가 조회는
  // 결과 조립 단계에서만 필요하므로 재생 루프 밖으로 뺀다.
  private evaluateBenchmark(context: {
    command: ReplayBacktestCommand;
    matched: ReturnType<typeof matchRecommendationCycles>;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    benchmarkCloses: BenchmarkCloseInput[];
    lastTradeDate: string | null;
  }): BenchmarkOutcome {
    if (context.benchmarkCloses.length === 0) {
      return { meanExcessReturnRate: null, benchmarkUnavailableCount: 0 };
    }
    // 실제로 매매가 일어난 종목만 담는다. 유니버스 전체를 담으면 수십만 행을 복사하는데
    // 벤치마크 계산은 사이클에 등장한 종목만 참조하므로 전부 낭비다.
    const cycleTickerIds = new Set(
      context.matched.cycles.map((cycle) => cycle.tickerId),
    );
    const dailyPrices: ShadowDailyPriceInput[] = [];
    for (const tickerId of cycleTickerIds) {
      const market = context.tickerById.get(tickerId)?.krxMarket;
      if (market === undefined) {
        continue;
      }
      for (const bar of context.barsByTicker.get(tickerId) ?? []) {
        dailyPrices.push({
          tickerId,
          market: market as PaperMarket,
          tradeDate: bar.tradeDate,
          // IndicatorBar.close 는 읽기 전용 DecimalValue 라 산술이 되는 MoneyValue 로 옮긴다.
          close: new Prisma.Decimal(bar.close.toString()),
        });
      }
    }
    const evaluationDate =
      context.lastTradeDate === null
        ? new Date(`${context.command.to}T00:00:00.000Z`)
        : new Date(`${context.lastTradeDate}T00:00:00.000Z`);
    const performance = calculateBenchmarkPerformance({
      cycles: context.matched.cycles,
      evaluationDate,
      dailyPrices,
      benchmarkCloses: context.benchmarkCloses,
    });
    return {
      meanExcessReturnRate: performance.meanExcessReturnRate,
      benchmarkUnavailableCount: performance.benchmarkUnavailableCount,
    };
  }

  private findBar(
    barsByTicker: Map<number, BacktestBar[]>,
    tickerId: number,
    tradeDate: string,
  ): BacktestBar | null {
    const bars = barsByTicker.get(tickerId) ?? [];
    return bars.find((bar) => dateTextOf(bar.tradeDate) === tradeDate) ?? null;
  }

  // 체결은 봉이 있는 날에만 성사된다. tradeDates 는 구간(from~to)으로 이미 잘려 있으므로
  // "today 뒤의 원소가 있는가" 가 곧 "구간 안에 체결될 날이 남았는가" 다. 평일 기준으로
  // 판정하면 to 가 마지막 시세 뒤의 평일·휴장일일 때 체결되지 않는 주문을 만들게 된다.
  private hasTradeDateAfter(tradeDates: string[], today: string): boolean {
    return tradeDates.some((tradeDate) => tradeDate > today);
  }

  private latestTradeDateOnOrBefore(
    tradeDates: string[],
    target: string,
  ): string | null {
    let found: string | null = null;
    for (const tradeDate of tradeDates) {
      if (tradeDate <= target) {
        found = tradeDate;
      }
    }
    return found;
  }

  private buildCandidates(
    tickers: BacktestTicker[],
    barsByTicker: Map<number, BacktestBar[]>,
    asOf: string,
  ): ScreenCandidate[] {
    const candidates: ScreenCandidate[] = [];
    for (const ticker of tickers) {
      const bars = (barsByTicker.get(ticker.tickerId) ?? []).filter(
        (bar) => dateTextOf(bar.tradeDate) <= asOf,
      );
      const latest = bars.at(-1);
      // 마지막 봉이 asOf 가 아니면 그 종목은 그날 거래되지 않았다.
      // 지연된 가격을 오늘 후보로 섞으면 횡단면 순위가 오염된다.
      if (!latest || dateTextOf(latest.tradeDate) !== asOf) {
        continue;
      }
      const indicators = calculateIndicators(bars.slice(-INDICATOR_BAR_LIMIT));
      if (indicators === null) {
        continue;
      }
      candidates.push({
        tickerId: ticker.tickerId,
        code: ticker.code,
        name: ticker.name,
        krxMarket: ticker.krxMarket,
        indicators,
      });
    }
    return candidates;
  }

  private valuate(
    ledger: InMemoryPaperLedger,
    barsByTicker: Map<number, BacktestBar[]>,
    asOf: string,
  ): number {
    let total = Number(ledger.cashBalance.toString());
    for (const position of ledger.openPositions()) {
      const bars = (barsByTicker.get(position.tickerId) ?? []).filter(
        (bar) => dateTextOf(bar.tradeDate) <= asOf,
      );
      const latest = bars.at(-1);
      if (!latest) {
        continue;
      }
      total += Number(position.quantity.toString()) * latest.close.toNumber();
    }
    return total;
  }
}
