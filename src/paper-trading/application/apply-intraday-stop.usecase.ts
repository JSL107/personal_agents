import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DailyBar } from '../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import { ResolveStrategyParametersUsecase } from '../../strategy-parameter/application/resolve-strategy-parameters.usecase';
import {
  describeSuspiciousPriceJump,
  detectSuspiciousPriceJump,
} from '../domain/corporate-action-guard';
import {
  decideIntradayStopOrders,
  DEFAULT_EXIT_BAND,
  describeIntradayStopReason,
  ExitBandThreshold,
  IntradayStopCandidate,
  IntradayStopDecision,
} from '../domain/exit-band';
import { PaperMarket, TradeStrategy } from '../domain/paper-account.type';
import { PendingOrderFillResult } from '../domain/port/paper-order-ledger.port';
import { getKstClock } from '../domain/trade-calendar';
import {
  PaperAccountNamedRecord,
  PaperPositionWithTicker,
  PaperTradingPrismaRepository,
} from '../infrastructure/paper-trading.prisma.repository';
import { strategyOf } from './apply-exit-band.usecase';
import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';

export interface ApplyIntradayStopCommand {
  executedAt: Date;
  agentRunId?: number | null;
  stopLossPercent?: number;
}

export interface IntradayStopFill {
  accountName: string;
  tickerCode: string;
  tickerName: string;
  quantity: string;
  price: string;
  returnRatePercent: number;
}

// 계좌 하나가 왜 통째로 빠졌는지. 건수만 세면 Slack 이 "원장을 보라" 고 안내해도 원장에
// 숫자밖에 없어 무엇을 볼 수가 없다.
export interface IntradayStopAccountFailure {
  accountName: string;
  reason: string;
}

export interface ApplyIntradayStopResult {
  window: 'BEFORE_OPEN' | 'TRADING' | 'AFTER_CLOSE';
  accountCount: number;
  inspectedCount: number;
  // 시세 조회가 예외로 끊긴 종목 수. 공급자 장애 신호다.
  priceErrorCount: number;
  // 조회는 됐는데 오늘 봉이 없는 종목 수. 휴장이거나 그 종목만 거래정지다.
  // 예외와 합쳐 세면 "장이 안 열렸다" 와 "시세가 안 온다" 를 가를 수 없다.
  notTradedCount: number;
  // 하루 가격제한 밖으로 튄 종목 수. 분할·배당락 같은 기업행동이라 판정을 보류했다.
  corporateActionCount: number;
  // 보류 사유. 건수만 세면 어느 종목이 왜 빠졌는지 알 수 없어 사람이 확인할 수 없다.
  corporateActions: string[];
  decidedCount: number;
  filledCount: number;
  // 주문은 만들었는데 체결하지 못해 되돌린 수. 다음 회차가 새 현재가로 다시 판정한다.
  fillFailureCount: number;
  fills: IntradayStopFill[];
  skippedByPendingSell: number;
  skippedByNoPosition: number;
  // 계좌 단위로 격리하느라 삼킨 예외. 세지 않으면 DB·체결 실패가 "손절 0건" 과
  // 구분되지 않아, 고장난 회차가 조용한 정상 회차로 보고된다.
  accountFailureCount: number;
  accountFailures: IntradayStopAccountFailure[];
}

interface CandidateContext {
  decision: IntradayStopDecision;
  tickerName: string;
}

const emptyResult = (
  window: ApplyIntradayStopResult['window'],
): ApplyIntradayStopResult => ({
  window,
  accountCount: 0,
  inspectedCount: 0,
  priceErrorCount: 0,
  notTradedCount: 0,
  corporateActionCount: 0,
  corporateActions: [],
  decidedCount: 0,
  filledCount: 0,
  fillFailureCount: 0,
  fills: [],
  skippedByPendingSell: 0,
  skippedByNoPosition: 0,
  accountFailureCount: 0,
  accountFailures: [],
});

const findTodayBarIndex = (bars: DailyBar[], tradeDate: string): number =>
  bars.findIndex(
    (candidate) => candidate.tradeDate.toISOString().slice(0, 10) === tradeDate,
  );

const parseMarket = (value: string | null): PaperMarket | null => {
  if (value === 'KOSPI' || value === 'KOSDAQ' || value === 'KONEX') {
    return value;
  }
  return null;
};

@Injectable()
export class ApplyIntradayStopUsecase {
  constructor(
    private readonly repository: PaperTradingPrismaRepository,
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly executeOrder: ExecutePaperOrderUsecase,
    private readonly strategyParameters: ResolveStrategyParametersUsecase,
  ) {}

  async execute(
    command: ApplyIntradayStopCommand,
  ): Promise<ApplyIntradayStopResult> {
    const { tradeDate, minutes } = getKstClock(command.executedAt);
    if (minutes < 9 * 60 + 30) {
      return emptyResult('BEFORE_OPEN');
    }
    // 15:20~15:30 마감 동시호가는 가격이 튈 수 있고, 10분 뒤 종가 밴드가 다시 판정한다.
    if (minutes >= 15 * 60 + 20) {
      return emptyResult('AFTER_CLOSE');
    }

    const accounts = await this.repository.findAllAccounts();
    const result = emptyResult('TRADING');
    result.accountCount = accounts.length;
    const tradeDay = new Date(`${tradeDate}T00:00:00.000Z`);
    // 손절선은 종가 밴드와 같은 원장(`strategy_parameter`)에서 온다. 상수를 따로 읽으면
    // 원장에서 값을 바꿨을 때 종가 밴드만 따라가고 장중 손절은 옛 값에 남아, 같은 계좌가
    // 두 기준으로 청산된다. 전략당 한 번만 해소해 같은 회차가 같은 값을 쓰게 한다.
    const thresholdByStrategy = new Map<TradeStrategy, ExitBandThreshold>();
    const resolveThreshold = async (
      accountName: string,
    ): Promise<ExitBandThreshold> => {
      if (command.stopLossPercent !== undefined) {
        return {
          takeProfitPercent: DEFAULT_EXIT_BAND.takeProfitPercent,
          stopLossPercent: command.stopLossPercent,
        };
      }
      const strategy = strategyOf(accountName);
      // 수동 계좌는 전략 파라미터의 대상이 아니다(종가 밴드와 같은 판단).
      if (strategy === 'MANUAL') {
        return DEFAULT_EXIT_BAND;
      }
      const cached = thresholdByStrategy.get(strategy);
      if (cached !== undefined) {
        return cached;
      }
      const parameters = await this.strategyParameters.execute(strategy);
      thresholdByStrategy.set(strategy, parameters.exitBand);
      return parameters.exitBand;
    };

    for (const account of accounts) {
      try {
        await this.applyToAccount({
          account,
          command,
          threshold: await resolveThreshold(account.name),
          tradeDate,
          tradeDay,
          result,
        });
      } catch (error) {
        result.accountFailureCount += 1;
        result.accountFailures.push({
          accountName: account.name,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }
    return result;
  }

  private async applyToAccount(input: {
    account: PaperAccountNamedRecord;
    command: ApplyIntradayStopCommand;
    threshold: ExitBandThreshold;
    tradeDate: string;
    tradeDay: Date;
    result: ApplyIntradayStopResult;
  }): Promise<void> {
    const positions = await this.repository.findPositionsWithTicker(
      input.account.id,
    );
    const candidates = await this.collectCandidates(
      positions,
      input.tradeDate,
      input.result,
    );
    const decisions = decideIntradayStopOrders(
      candidates,
      input.threshold.stopLossPercent,
    );
    input.result.decidedCount += decisions.length;
    if (decisions.length === 0) {
      return;
    }

    const strategy = strategyOf(input.account.name);
    const outcome = await this.repository.createExitBandOrders({
      accountId: input.account.id,
      strategy,
      decidedAt: input.command.executedAt,
      dataAsOf: input.tradeDay,
      targetTradeDate: input.tradeDay,
      agentRunId: input.command.agentRunId ?? null,
      // 익절값도 함께 박아야 성적 집계가 읽는 밴드 라벨이 종가 밴드와 같은 형식으로 남는다.
      threshold: input.threshold,
      orders: decisions.map((decision) => ({
        tickerId: decision.tickerId,
        reason: describeIntradayStopReason(
          decision,
          input.threshold.stopLossPercent,
        ),
      })),
    });
    input.result.skippedByPendingSell += outcome.skippedByPendingSell;
    input.result.skippedByNoPosition += outcome.skippedByNoPosition;

    const createdTickerIds = new Set(outcome.createdTickerIds);
    if (createdTickerIds.size === 0) {
      return;
    }
    const contextByTickerId = new Map<number, CandidateContext>();
    for (const decision of decisions) {
      const position = positions.find(
        (candidate) => candidate.tickerId === decision.tickerId,
      );
      if (position) {
        contextByTickerId.set(decision.tickerId, {
          decision,
          tickerName: position.ticker.name,
        });
      }
    }
    const dueOrders = await this.repository.findDuePendingOrders(
      input.tradeDay,
    );
    const createdOrders = dueOrders.filter(
      (order) =>
        order.accountId === input.account.id &&
        order.side === 'SELL' &&
        createdTickerIds.has(order.tickerId),
    );
    for (const order of createdOrders) {
      const context = contextByTickerId.get(order.tickerId);
      if (!context) {
        continue;
      }
      const market = parseMarket(order.krxMarket);
      if (!market) {
        await this.repository.expirePendingOrder(
          order.id,
          '종목 시장 구분 없음',
        );
        continue;
      }
      // ponytail: 판정가 즉시 체결을 가정한다. 급락장 슬리피지는 실측 후 별도 반영해야 한다.
      let fill: PendingOrderFillResult;
      try {
        fill = await this.executeOrder.execute({
          orderId: order.id,
          accountId: order.accountId,
          tickerId: order.tickerId,
          market,
          side: 'SELL',
          requestedQuantity: order.quantity.toString(),
          price: context.decision.price,
          tradeDate: input.tradeDate,
          strategy: order.strategy,
        });
      } catch {
        await this.rollbackUnfilledOrder(order.id, input.result);
        continue;
      }
      if (fill.status !== 'FILLED') {
        await this.rollbackUnfilledOrder(order.id, input.result);
        continue;
      }
      input.result.filledCount += 1;
      input.result.fills.push({
        accountName: input.account.name,
        tickerCode: context.decision.tickerCode,
        tickerName: context.tickerName,
        quantity: fill.quantity,
        price: context.decision.price,
        returnRatePercent: context.decision.returnRatePercent,
      });
    }
  }

  // 주문만 만들고 체결하지 못하면 그 SELL 은 PENDING 으로 남는다. 그러면 같은 거래일에
  // 도는 체결기(FillPendingOrdersUsecase)가 그것을 당일 **시가**로 체결한다 — 장중 손절이
  // 시가 매도로 둔갑하고, 원장에는 장중 손절 사유가 박힌 채 엉뚱한 가격이 남는다.
  // 게다가 다음 장중 회차는 그 종목에 PENDING SELL 이 있어 판정만 하고 건너뛰므로
  // (`skippedByPendingSell`) 스스로 회복하지도 못한다.
  //
  // 그래서 되돌린다. 다음 회차가 새 현재가로 다시 판정하고 새 주문을 만든다.
  private async rollbackUnfilledOrder(
    orderId: number,
    result: ApplyIntradayStopResult,
  ): Promise<void> {
    result.fillFailureCount += 1;
    try {
      await this.repository.expirePendingOrder(orderId, '장중 손절 체결 실패');
    } catch {
      // 되돌리기까지 실패하면 PENDING 주문 하나가 남는다. 여기서 더 할 수 있는 일이 없고,
      // 예외를 올리면 같은 계좌의 나머지 종목까지 놓친다. 건수는 위에서 이미 셌다.
    }
  }

  private async collectCandidates(
    positions: PaperPositionWithTicker[],
    tradeDate: string,
    result: ApplyIntradayStopResult,
  ): Promise<IntradayStopCandidate[]> {
    const candidates: IntradayStopCandidate[] = [];
    for (const position of positions) {
      let bars: DailyBar[];
      try {
        // 2봉을 받는다. 전일 종가가 없으면 기업행동 판정 자체가 불가능하고, 그러면
        // 배당락·분할로 튄 가격이 그대로 손절 판정에 들어간다.
        bars = await this.marketData.fetchDailyBars(
          position.ticker.tossSymbol,
          2,
          { adjusted: false },
        );
      } catch {
        result.priceErrorCount += 1;
        continue;
      }
      // 오늘 봉이 없는 것은 장애가 아니다 — 휴장이거나 그 종목만 거래정지다. 예외와
      // 합쳐 세면 "장이 안 열렸다" 와 "시세가 안 온다" 를 가를 수 없고, 그러면 휴장마다
      // 장애 카드가 나가거나 반대로 진짜 장애가 휴장으로 묻힌다.
      const todayIndex = findTodayBarIndex(bars, tradeDate);
      if (todayIndex < 0) {
        result.notTradedCount += 1;
        continue;
      }
      const todayBar = bars[todayIndex];
      let price: Prisma.Decimal;
      try {
        price = new Prisma.Decimal(todayBar.close.toString());
      } catch {
        result.priceErrorCount += 1;
        continue;
      }
      // 봉은 왔는데 값이 쓸 수 없는 꼴이면 공급자 쪽 문제다.
      if (!price.isFinite() || price.comparedTo(0) <= 0) {
        result.priceErrorCount += 1;
        continue;
      }
      // 전일 봉이 없으면(신규 상장 첫 봉) 판정 근거가 없어 건너뛴다 — 장마감 평가가
      // `bars.length < 2` 를 다루는 방식과 같다.
      const previousBar = todayIndex > 0 ? bars[todayIndex - 1] : null;
      if (previousBar) {
        const [suspicion] = detectSuspiciousPriceJump([
          {
            tickerId: position.tickerId,
            previousClose: new Prisma.Decimal(previousBar.close.toString()),
            currentClose: price,
          },
        ]);
        // 기업행동이면 이 가격으로 손익률을 재서는 안 된다. 배당락을 폭락으로 읽으면
        // 밴드를 한참 밑도는 손익률이 나와 멀쩡한 보유분이 통째로 청산된다.
        if (suspicion) {
          result.corporateActionCount += 1;
          result.corporateActions.push(
            describeSuspiciousPriceJump(
              suspicion,
              `${position.ticker.name}(${position.ticker.code})`,
            ),
          );
          continue;
        }
      }
      const averagePrice = new Prisma.Decimal(position.avgPrice.toString());
      // 평단 0 은 손익률을 정의할 수 없다. 판정하지 않았으므로 inspected 에도 넣지 않는다.
      if (averagePrice.isZero()) {
        continue;
      }
      result.inspectedCount += 1;
      const returnRatePercent = price
        .minus(averagePrice)
        .dividedBy(averagePrice)
        .times(100);
      candidates.push({
        tickerId: position.tickerId,
        tickerCode: position.ticker.code,
        quantity: position.quantity.toString(),
        returnRatePercent: returnRatePercent.toNumber(),
        price: price.toString(),
      });
    }
    return candidates;
  }
}
