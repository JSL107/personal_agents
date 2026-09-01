import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { constrainPaperRecommendation } from '../../agent/paper-recommend/domain/paper-recommendation.constraint';
import { planPendingOrders } from '../../agent/paper-recommend/domain/pending-order-plan';
import {
  calculateIndicators,
  VolatilityEstimator,
} from '../../market-data/domain/stock-indicator';
import { ExecutePaperOrderUsecase } from '../../paper-trading/application/execute-paper-order.usecase';
import {
  decideExitBandOrders,
  decideIntradayStopOrders,
  ExitBandCandidate,
  ExitBandThreshold,
  IntradayStopCandidate,
  resolveIntradayStopFillPrice,
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
import { applySlippage } from '../domain/slippage';
import { selectDeterministicRecommendation } from '../domain/top-scored-selection';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { InMemoryPaperLedger } from '../infrastructure/in-memory-paper-ledger';

// 지표는 최대 200봉을 본다. 재생 시작일보다 이만큼 앞선 봉을 미리 읽어야 첫날부터
// ma120·200일 고점이 계산된다. 200거래일은 약 290일이므로 휴장 여유를 포함해 400일 앞당긴다.
const WARMUP_CALENDAR_DAYS = 400;
const INDICATOR_BAR_LIMIT = 200;

/**
 * 같은 구간을 파라미터만 바꿔가며 여러 번 재생할 때, **파라미터와 무관한 계산**을 나눠 쓰는
 * 그릇. 탐색기가 이것을 창 하나당 하나씩 만들어 넘긴다.
 *
 * 재생 1회의 97% 가 후보 산출(전 종목 지표 계산)이고, 그 계산의 입력은 `(종목·봉·기준일)`
 * 뿐이라 청산 밴드·거래대금 하한·비중 어느 것에도 의존하지 않는다(실측: 거래대금 하한을
 * 통과 불가능한 값으로 줘 주문이 7건만 나와도 60거래일 재생이 39.1초로, 정상 회차 40.1초와
 * 같다). 조합마다 같은 계산을 다시 하면 밴드 축 하나가 13시간이 된다.
 *
 * **구간과 변동성 추정량이 캐시의 정체성이다.** `findUniverse` 는 `from` 으로, 봉 조회는
 * `from`·`to` 로 범위가 갈리고, `volatilityEstimator` 는 후보의 지표 자체를 바꾼다
 * (`--volatility parkinson` 은 `volatility20` 을 다른 식으로 재 순위를 재편한다). 어느
 * 하나라도 다른 재생에 재사용하면 조용히 다른 표본을 재게 되므로 `execute` 가 끊는다.
 *
 * 나머지 축(청산 밴드·거래대금 하한·비중)은 후보 산출 뒤에서만 쓰이므로 정체성이 아니다.
 * **후보 산출에 새 인자가 늘면 이 목록도 함께 늘려야 한다.**
 */
export interface ReplayWindowCache {
  readonly from: string;
  readonly to: string;
  readonly volatilityEstimator: VolatilityEstimator;
  tickers?: BacktestTicker[];
  barsByTicker?: Map<number, BacktestBar[]>;
  benchmarkCloses?: BenchmarkCloseInput[];
  readonly candidatesByAsOf: Map<string, ScreenCandidate[]>;
}

export const createReplayWindowCache = (
  from: string,
  to: string,
  volatilityEstimator: VolatilityEstimator,
): ReplayWindowCache => ({
  from,
  to,
  volatilityEstimator,
  candidatesByAsOf: new Map(),
});

export interface ReplayBacktestCommand {
  strategy: ScreenStrategy;
  from: string;
  to: string;
  seedAmount: string;
  minimumTurnover60: number;
  // 당일 상승률 상한(%). 값을 바꿔가며 "급등 당일 매수" 를 얼마나 걸러야 하는지 잰다.
  maximumDailyGainPercent: number;
  maximumPositions: number;
  weightPercent: number;
  holdingTradeDays: number;
  exitBand: ExitBandThreshold | null;
  // 보유 중 상장폐지된 종목을 마지막 종가의 몇 배로 청산할지. 1 이면 마지막 종가 그대로다.
  // 기본을 1 로 둔 것은 근거가 있어서가 아니라 없어서다 — 정리매매 회수율은 폐지 사유마다
  // 다르고 그 사유가 우리 데이터에 없다. 값을 낮춰 성적이 얼마나 흔들리는지 재는 손잡이다.
  delistingRecoveryRate: number;
  // 변동성 추정량. LONG_TERM 의 순위 재료(`volatility20`)를 무엇으로 재는지 가른다.
  // 운영은 종가→종가 하나뿐이고, 이 손잡이는 다른 추정량의 성적을 재기 위해서만 있다.
  volatilityEstimator: VolatilityEstimator;
  // 체결가를 몇 % 불리하게 잡을지(매수 +x%, 매도 −x%). 0 이 미반영이고 그것이 기본이다.
  // 슬리피지를 흉내 내려는 값이 아니라 "얼마부터 결론이 무너지나" 를 재는 손잡이다
  // (`applySlippage` 주석). 후보 산출 뒤에서만 쓰이므로 창 캐시의 정체성이 아니다.
  slippagePercent: number;
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
  // 어느 변동성 추정량으로 돌렸는지. 결과만 보고는 조건을 알 수 없어 두 조건의 성적을
  // 섞어 읽게 된다 — 손잡이를 남긴 이상 그 값이 산출물에 남아야 한다.
  volatilityEstimator: VolatilityEstimator;
  // 같은 이유로 체결가 가정도 산출물에 남긴다. 0 이 아닌 회차는 운영 재현이 아니다.
  slippagePercent: number;
  exitBandSellCounts: { takeProfit: number; stopLoss: number };
  // 장중에 손절선을 뚫어 그날 안에 팔린 건수. 종가 밴드 손절(`exitBandSellCounts.stopLoss`)과
  // 따로 센다 — 둘을 합치면 "하루 안에 끝난 손절" 과 "다음 거래일 시가에 넘긴 손절" 이
  // 한 칸에 묻혀, 장중 재현을 넣기 전후 성적을 비교할 수 없다.
  intradayStopSellCount: number;
  // 그 손절이 얼마나 여유 있게 발동했나 — 저가가 손절선보다 몇 %p 아래였나. 얇은 밴드가
  // 믿을 만한지를 이 분포가 정한다.
  //
  // **평균만으로는 판정할 수 없다.** 소수의 큰 하락이 평균을 끌어올리면 "대체로 여유 있다"
  // 처럼 보이지만, 정작 물어야 하는 것은 "손절선을 겨우 스쳐 발동한 건이 얼마나 잦은가" 다
  // (PR #447 이대리 리뷰 지적). 그래서 최소·10분위·중앙값을 함께 낸다 — 10분위가 호가 한 틱
  // (주가의 약 0.13%) 수준이면 그 밴드는 노이즈로 발동하는 것이다.
  //
  // `gapDownCount` 는 시가부터 이미 손절선 아래여서 체결가가 시가로 잡힌 건수다. 그 경로는
  // 손절선보다 낮은 가격에 팔므로 재생이 **보수적으로** 처리한 쪽이다.
  intradayStopMargin: {
    meanPercent: number | null;
    medianPercent: number | null;
    p10Percent: number | null;
    minPercent: number | null;
    gapDownCount: number;
  };
  // 고가가 없어 조정 종가로 대신한 봉이 섞인 후보. 폐지 종목은 재적재 대상이 아니어서
  // (`findUniverseTickers` 는 `delistedAt: null` 만 본다) 전 구간이 이 경로를 타고, 토스 404 라
  // 앞으로도 채울 수 없다. 대신 쓴 종가는 분모(200봉 최고가)를 낮추므로 신고가 위치가
  // **부풀려진다** — 활성 종목 2,559개 실측으로 평균 7.26% 다. 그 종목이 후보에 얼마나
  // 올랐는지 모르면 성적에 섞인 이 이득의 크기를 읽을 수 없다.
  highFallback: { candidateCount: number; tickerCount: number };
  // 보유 중 폐지돼 강제 청산된 건수와 그 청산 대금. 0 이면 이 구간에 폐지 보유가 없었다는
  // 뜻이지 폐지 종목이 후보에서 빠졌다는 뜻이 아니다.
  delistedLiquidation: { count: number; proceeds: string };
  delistingRecoveryRate: number;
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
  intradayStopSells: number;
  // 여유폭 전량. 분위수를 내려면 값을 들고 있어야 한다 — 손절은 창당 수백 건이라 무해하다.
  intradayStopMargins: number[];
  intradayStopGapDowns: number;
  highFallbackCandidateCount: number;
  highFallbackTickerIds: Set<number>;
  delistedLiquidatedCount: number;
  delistedProceeds: number;
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

/**
 * 여유폭 분포. **평균만 내면 소수의 큰 하락이 판정을 뒤집는다** — 10분위가 호가 한 틱
 * 수준이면 그 밴드는 손절선을 겨우 스쳐 발동하는 것이고, 평균이 커도 그 사실은 가려진다.
 */
const summarizeMargins = (
  margins: number[],
): {
  meanPercent: number | null;
  medianPercent: number | null;
  p10Percent: number | null;
  minPercent: number | null;
} => {
  if (margins.length === 0) {
    return {
      meanPercent: null,
      medianPercent: null,
      p10Percent: null,
      minPercent: null,
    };
  }
  const sorted = [...margins].sort((left, right) => left - right);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    meanPercent:
      margins.reduce((sum, margin) => sum + margin, 0) / margins.length,
    medianPercent: at(0.5),
    p10Percent: at(0.1),
    minPercent: sorted[0],
  };
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

  async execute(
    command: ReplayBacktestCommand,
    cache?: ReplayWindowCache,
  ): Promise<ReplayBacktestResult> {
    if (
      cache !== undefined &&
      (cache.from !== command.from ||
        cache.to !== command.to ||
        cache.volatilityEstimator !== command.volatilityEstimator)
    ) {
      throw new Error(
        `재생 캐시가 다른 조건의 것입니다 ` +
          `(캐시 ${cache.from}~${cache.to}/${cache.volatilityEstimator} / ` +
          `요청 ${command.from}~${command.to}/${command.volatilityEstimator}).`,
      );
    }
    // 유니버스 기준일은 재생 시작일이다. 그 뒤에 폐지된 종목도 살아 있던 날까지는 후보다.
    const tickers =
      cache?.tickers ??
      (await this.repository.findUniverse(
        new Date(`${command.from}T00:00:00.000Z`),
      ));
    const barsByTicker =
      cache?.barsByTicker ??
      (await this.repository.findBarsInRange(
        tickers.map((ticker) => ticker.tickerId),
        this.warmupFrom(command.from),
        new Date(`${command.to}T00:00:00.000Z`),
      ));
    if (cache !== undefined) {
      cache.tickers = tickers;
      cache.barsByTicker = barsByTicker;
    }
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
      intradayStopSells: 0,
      intradayStopMargins: [],
      intradayStopGapDowns: 0,
      highFallbackCandidateCount: 0,
      highFallbackTickerIds: new Set<number>(),
      delistedLiquidatedCount: 0,
      delistedProceeds: 0,
    };

    const allDates = [
      ...new Set([...calendar.recommendDates, ...calendar.tradeDates]),
    ].sort();

    for (const today of allDates) {
      // 하루 순서는 체결(시가) → 장중 손절(저가) → 밴드 판정(종가) → 추천이다. 운영에서
      // 장 시작 체결·장중 감시(5분)·장마감 평가·밴드가 19:30 추천보다 먼저 도는 것과 같고,
      // 밴드는 종가가 있는 거래일에만 판정한다.
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
        // 폐지 청산은 체결 뒤·밴드 앞이다. 그날 대기 주문이 먼저 처리돼야 이미 팔린 것을
        // 두 번 팔지 않고, 폐지로 사라진 보유는 밴드 판정에 오르지 않는다.
        await this.liquidateDelisted({
          today,
          command,
          barsByTicker,
          tickerById,
          ledger,
          executeOrder,
          fills,
          entryIndexByTicker,
          state,
        });
        // 폐지 청산 뒤다 — 폐지로 이미 정리된 보유를 다시 팔지 않는다. 종가 밴드 앞이라
        // 장중에 손절선을 뚫은 보유는 그날 안에 정리되고, 밴드는 살아남은 것만 본다.
        await this.applyIntradayStop({
          today,
          command,
          barsByTicker,
          tickerById,
          ledger,
          executeOrder,
          fills,
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
          candidatesByAsOf: cache?.candidatesByAsOf,
        });
      }
    }

    const benchmarkCloses =
      cache?.benchmarkCloses ??
      (await this.repository.findBenchmarkCloses(
        new Date(`${command.from}T00:00:00.000Z`),
        new Date(`${command.to}T00:00:00.000Z`),
      ));
    if (cache !== undefined) {
      cache.benchmarkCloses = benchmarkCloses;
    }

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
      // 이미 폐지된 종목은 새로 사지 않는다. 폐지일에 봉이 남아 있으면(정리매매 마지막 날에
      // 목록에서 빠지는 경우) 전 거래일 추천이 여기서 체결되고 같은 날 liquidateDelisted 가
      // 즉시 되파는 왕복이 생긴다 — 수수료·세금과 당일 등락이 성적에 섞이고, 같은 날짜를
      // 거래 불가로 보는 buildCandidates 와 규칙이 갈린다. 매도는 그대로 체결한다(정리매매).
      if (
        order.side === 'BUY' &&
        ticker?.delistedAt != null &&
        dateTextOf(ticker.delistedAt) <= context.today
      ) {
        context.state.expiredCount += 1;
        context.expirations.push({
          tradeDate: context.today,
          statusReason: '상장폐지',
        });
        context.ledger.markOrderStatus(order.orderId, 'EXPIRED');
        continue;
      }
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
      // 시가 그대로가 아니라 손잡이만큼 불리하게 민 값으로 체결한다(기본 0 = 시가 그대로).
      const fillPrice = applySlippage(
        bar.open,
        order.side,
        context.command.slippagePercent,
      );
      const fill = await context.executeOrder.execute({
        orderId: order.orderId,
        accountId: context.ledger.accountId,
        tickerId: order.tickerId,
        market: ticker.krxMarket as PaperMarket,
        side: order.side,
        requestedQuantity: String(order.quantity),
        price: String(fillPrice),
        tradeDate: context.today,
        strategy: context.command.strategy,
      });
      if (fill.status === 'FILLED') {
        context.state.filledCount += 1;
        context.fills.push({
          tradeDate: context.today,
          filledAmount: Number(fill.quantity) * fillPrice,
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

  // 보유 중 상장폐지된 종목을 마지막 종가로 청산한다. 이것이 없으면 폐지 종목은 봉이 끊긴
  // 채 보유로 남아, 매도 주문을 내도 시가가 없어 만료되고 평가액에는 마지막 종가가 영원히
  // 잡힌다 — 폐지를 유니버스에 들이면서 손실만 빼는 꼴이라 생존 편향을 지우는 대신 키운다.
  // 청산가를 마지막 종가로 둔 것은 그것이 옳아서가 아니라 폐지 사유(부실 폐지·합병·자진
  // 상폐)를 우리 데이터가 모르기 때문이다. 회수율 손잡이가 그 모름을 성적으로 재는 수단이다.
  private async liquidateDelisted(context: {
    today: string;
    command: ReplayBacktestCommand;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    ledger: InMemoryPaperLedger;
    executeOrder: ExecutePaperOrderUsecase;
    fills: BacktestFillRecord[];
    entryIndexByTicker: Map<number, number>;
    state: ReplayState;
  }): Promise<void> {
    for (const position of context.ledger.openPositions()) {
      const ticker = context.tickerById.get(position.tickerId);
      if (
        ticker === undefined ||
        ticker.delistedAt === null ||
        dateTextOf(ticker.delistedAt) > context.today
      ) {
        continue;
      }
      const bars = (context.barsByTicker.get(position.tickerId) ?? []).filter(
        (bar) => dateTextOf(bar.tradeDate) <= context.today,
      );
      const latest = bars.at(-1);
      // 봉이 하나도 없으면 청산가를 지어낼 수 없다. 조용히 남기면 좀비 보유가 되므로
      // 원장 이상으로 드러나게 두고, 건수는 세지 않는다(청산이 일어나지 않았으므로).
      if (latest === undefined) {
        continue;
      }
      // 회수율에 더해 체결가 손잡이도 태운다 — 재생의 모든 체결에 같은 규칙을 적용해야
      // "이 조합만 슬리피지를 안 문다" 는 구멍이 안 생긴다. 폐지 청산은 매도다.
      const price = applySlippage(
        latest.close.toNumber() * context.command.delistingRecoveryRate,
        'SELL',
        context.command.slippagePercent,
      );
      // 비중 지표는 체결 직전 평가액 대비로 잰다. 일반 체결과 같은 기준이어야 한 표에서 읽힌다.
      const valuationBefore = this.valuate(
        context.ledger,
        context.barsByTicker,
        context.today,
      );
      const orderId = context.state.nextOrderId;
      context.ledger.recordOrder({
        id: orderId,
        accountId: context.ledger.accountId,
        tickerId: position.tickerId,
        side: 'SELL',
        strategy: context.command.strategy,
        status: 'PENDING',
        quantity: position.quantity,
        // 밴드 매도와 같은 이유로 규칙 버전을 남기지 않는다 — 스크리너가 만든 매도가 아니다.
        ruleVersion: null,
      });
      context.state.nextOrderId += 1;
      const fill = await context.executeOrder.execute({
        orderId,
        accountId: context.ledger.accountId,
        tickerId: position.tickerId,
        market: ticker.krxMarket as PaperMarket,
        side: 'SELL',
        requestedQuantity: position.quantity.toString(),
        price: String(price),
        tradeDate: context.today,
        strategy: context.command.strategy,
      });
      if (fill.status !== 'FILLED') {
        continue;
      }
      // 원장에 주문과 거래가 남았으므로 체결 통계에도 같이 넣는다. 빼면 orderCount 가
      // filledCount + expiredCount 보다 커져 청산 건수만큼 주문이 증발한 것처럼 보이고,
      // 일별 체결 진단에서도 이 체결만 빠진다.
      const filledAmount = Number(fill.quantity) * price;
      context.state.filledCount += 1;
      context.fills.push({
        tradeDate: context.today,
        filledAmount,
        accountValuation: valuationBefore,
      });
      context.state.delistedLiquidatedCount += 1;
      context.state.delistedProceeds += filledAmount;
      context.entryIndexByTicker.delete(position.tickerId);
      // 같은 종목에 남아 있던 대기 매도는 체결될 보유가 없어 만료로 흘러간다. 여기서 지우면
      // 만료 건수가 줄어 "주문을 냈는데 어떻게 됐나" 가 원장에서 사라진다.
    }
  }

  // 운영은 장중 5분마다 현재가를 재 손절선을 뚫으면 그 자리에서 판다. 일봉만 있는 재생이
  // 그 하루를 볼 수 있는 창은 저가 하나뿐이므로, "그날 저가가 손절선 아래였는가" 로 발동을
  // 판정한다 — 5분 관측이 놓친 순간까지 잡으므로 발동 횟수는 운영보다 많거나 같다.
  //
  // 체결가는 `resolveIntradayStopFillPrice` 가 정한다(고른 근거는 그 함수의 주석).
  //
  // 종가 밴드 손절은 저가가 있는 봉에서는 거의 발동하지 않게 된다 — 종가가 손절선 아래면
  // 저가도 반드시 아래라(저가 <= 종가) 이 판정이 그날 먼저 판다. 운영에서도 장중 감시가
  // 도는 한 같은 순서이므로 재현이 맞다. 종가 밴드는 저가를 모르는 봉의 안전망으로 남는다.
  private async applyIntradayStop(context: {
    today: string;
    command: ReplayBacktestCommand;
    barsByTicker: Map<number, BacktestBar[]>;
    tickerById: Map<number, BacktestTicker>;
    ledger: InMemoryPaperLedger;
    executeOrder: ExecutePaperOrderUsecase;
    fills: BacktestFillRecord[];
    entryIndexByTicker: Map<number, number>;
    state: ReplayState;
  }): Promise<void> {
    const exitBand = context.command.exitBand;
    if (exitBand === null) {
      return;
    }
    // 이미 대기 매도가 있는 종목은 건너뛴다. 운영도 pending SELL 이 있으면 판정만 하고
    // 넘긴다(skippedByPendingSell) — 없으면 같은 보유에 매도가 겹쳐 쌓인다.
    const pendingSellTickerIds = new Set(
      context.state.pendingOrders
        .filter((order) => order.side === 'SELL')
        .map((order) => order.tickerId),
    );
    const candidates: IntradayStopCandidate[] = [];
    // 발동한 뒤에는 보유가 사라져 평단을 다시 읽을 수 없다. 여유폭·갭하락 판정에 필요한
    // 손절선을 후보를 만들 때 함께 남긴다.
    const stopLineByTickerId = new Map<number, number>();
    for (const position of context.ledger.openPositions()) {
      if (pendingSellTickerIds.has(position.tickerId)) {
        continue;
      }
      const ticker = context.tickerById.get(position.tickerId);
      if (ticker === undefined) {
        continue;
      }
      const bar = this.findBar(
        context.barsByTicker,
        position.tickerId,
        context.today,
      );
      // 저가가 없으면 그 하루 안에서 손절선을 뚫었는지 알 방법이 없다. 시가가 없으면
      // 갭하락일 때 체결가를 만들 수 없다. 어느 쪽이든 판정하지 않고 넘긴다 — 종가 밴드가
      // 그날 종가로 다시 판정하므로 손절 자체가 사라지지는 않는다.
      if (bar === null || bar.low === null || bar.open === null) {
        continue;
      }
      const averagePrice = Number(position.avgPrice.toString());
      // 평단 0 은 손익률을 정의할 수 없다(운영 판정과 같은 조건).
      if (!Number.isFinite(averagePrice) || averagePrice <= 0) {
        continue;
      }
      const low = bar.low.toNumber();
      stopLineByTickerId.set(
        position.tickerId,
        averagePrice * (1 + exitBand.stopLossPercent / 100),
      );
      candidates.push({
        tickerId: position.tickerId,
        tickerCode: ticker.code,
        quantity: position.quantity.toString(),
        // 발동 판정은 저가 기준 손익률로 한다. `low <= stopLine` 과 같은 조건이며,
        // 손익률로 넘겨야 기업행동 가드(isLedgerMismatch)가 운영과 같은 잣대로 걸린다.
        returnRatePercent: (low / averagePrice - 1) * 100,
        // 운영은 판정가와 체결가가 같지만(그 순간 현재가로 판다) 재생은 다르다 — 판정은
        // 저가로, 체결은 도메인이 정한 `min(시가, 손절선)` 으로 한다.
        price: String(
          resolveIntradayStopFillPrice({
            open: bar.open,
            averagePrice,
            stopLossPercent: exitBand.stopLossPercent,
          }),
        ),
      });
    }

    const decisions = decideIntradayStopOrders(
      candidates,
      exitBand.stopLossPercent,
    );
    for (const decision of decisions) {
      const ticker = context.tickerById.get(decision.tickerId);
      if (ticker === undefined) {
        continue;
      }
      // 판정가(`decision.price`)는 도메인이 정한 `min(시가, 손절선)` 그대로 두고, 체결가만
      // 민다 — 손잡이는 "그 가격에 팔린다" 는 가정을 흔드는 것이지 발동 조건이 아니다.
      const price = applySlippage(
        Number(decision.price),
        'SELL',
        context.command.slippagePercent,
      );
      const valuationBefore = this.valuate(
        context.ledger,
        context.barsByTicker,
        context.today,
      );
      const orderId = context.state.nextOrderId;
      context.ledger.recordOrder({
        id: orderId,
        accountId: context.ledger.accountId,
        tickerId: decision.tickerId,
        side: 'SELL',
        strategy: context.command.strategy,
        status: 'PENDING',
        quantity: new Prisma.Decimal(decision.quantity),
        // 밴드 매도와 같은 이유로 규칙 버전을 남기지 않는다 — 스크리너가 만든 매도가 아니다.
        ruleVersion: null,
      });
      context.state.nextOrderId += 1;
      const fill = await context.executeOrder.execute({
        orderId,
        accountId: context.ledger.accountId,
        tickerId: decision.tickerId,
        market: ticker.krxMarket as PaperMarket,
        side: 'SELL',
        requestedQuantity: decision.quantity,
        price: String(price),
        tradeDate: context.today,
        strategy: context.command.strategy,
      });
      if (fill.status !== 'FILLED') {
        continue;
      }
      context.state.filledCount += 1;
      context.state.intradayStopSells += 1;
      // 저가 손익률이 손절선보다 얼마나 더 내려갔나(%p). 손익률로 비교하므로 조정 계열
      // 여부와 무관하다 — 가격 좌표계가 아니라 비율이다.
      context.state.intradayStopMargins.push(
        exitBand.stopLossPercent - decision.returnRatePercent,
      );
      const stopLine = stopLineByTickerId.get(decision.tickerId);
      if (stopLine !== undefined && price < stopLine) {
        context.state.intradayStopGapDowns += 1;
      }
      context.fills.push({
        tradeDate: context.today,
        filledAmount: Number(fill.quantity) * price,
        accountValuation: valuationBefore,
      });
      context.entryIndexByTicker.delete(decision.tickerId);
    }
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
    candidatesByAsOf: Map<string, ScreenCandidate[]> | undefined;
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
    // 캐시가 있으면 같은 구간의 앞선 재생이 만든 후보를 그대로 쓴다. `screenStocks` 도
    // `constrainPaperRecommendation` 도 후보를 변형하지 않고 새 객체로 복사하므로,
    // 조합이 바뀌어도 이 배열은 같은 값으로 남는다. 단 변동성 추정량은 후보 자체를
    // 바꾸므로 캐시의 정체성에 들어가 있다(`execute` 가 어긋남을 예외로 끊는다).
    const candidates =
      context.candidatesByAsOf?.get(asOf) ??
      this.buildCandidates(
        context.tickers,
        context.barsByTicker,
        asOf,
        context.command.volatilityEstimator,
      );
    context.candidatesByAsOf?.set(asOf, candidates);
    // 후보 단계에서 센다. 추천에 실린 것만 세면 "순위를 부풀린 이득이 얼마나 섞였나" 를
    // 놓친다 — 부풀린 값 때문에 다른 종목을 밀어낸 자리가 그쪽에는 남지 않는다.
    for (const candidate of candidates) {
      if (candidate.indicators.highFallbackBarCount > 0) {
        context.state.highFallbackCandidateCount += 1;
        context.state.highFallbackTickerIds.add(candidate.tickerId);
      }
    }
    const ranked = screenStocks(
      candidates,
      context.command.strategy,
      candidates.length,
      context.command.minimumTurnover60,
      context.command.maximumDailyGainPercent,
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
      volatilityEstimator: context.command.volatilityEstimator,
      slippagePercent: context.command.slippagePercent,
      exitBandSellCounts: {
        takeProfit: context.state.exitBandSells.TAKE_PROFIT,
        stopLoss: context.state.exitBandSells.STOP_LOSS,
      },
      intradayStopSellCount: context.state.intradayStopSells,
      intradayStopMargin: {
        ...summarizeMargins(context.state.intradayStopMargins),
        gapDownCount: context.state.intradayStopGapDowns,
      },
      highFallback: {
        candidateCount: context.state.highFallbackCandidateCount,
        tickerCount: context.state.highFallbackTickerIds.size,
      },
      delistedLiquidation: {
        count: context.state.delistedLiquidatedCount,
        proceeds: String(context.state.delistedProceeds),
      },
      delistingRecoveryRate: context.command.delistingRecoveryRate,
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
    volatilityEstimator: VolatilityEstimator,
  ): ScreenCandidate[] {
    const candidates: ScreenCandidate[] = [];
    for (const ticker of tickers) {
      // 이미 폐지된 종목은 후보가 아니다. 봉이 끊기면 아래 asOf 대조가 어차피 걸러내지만,
      // 폐지 마킹이 마지막 봉보다 이를 때(수집 주기 차이) 그 틈으로 폐지 종목을 사게 된다.
      if (ticker.delistedAt !== null && dateTextOf(ticker.delistedAt) <= asOf) {
        continue;
      }
      const bars = (barsByTicker.get(ticker.tickerId) ?? []).filter(
        (bar) => dateTextOf(bar.tradeDate) <= asOf,
      );
      const latest = bars.at(-1);
      // 마지막 봉이 asOf 가 아니면 그 종목은 그날 거래되지 않았다.
      // 지연된 가격을 오늘 후보로 섞으면 횡단면 순위가 오염된다.
      if (!latest || dateTextOf(latest.tradeDate) !== asOf) {
        continue;
      }
      const indicators = calculateIndicators(
        bars.slice(-INDICATOR_BAR_LIMIT),
        volatilityEstimator,
      );
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
