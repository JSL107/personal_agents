import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DailyBar } from '../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import {
  decideIntradayStopOrders,
  DEFAULT_STOP_LOSS_PERCENT,
  DEFAULT_TAKE_PROFIT_PERCENT,
  describeIntradayStopReason,
  IntradayStopCandidate,
  IntradayStopDecision,
} from '../domain/exit-band';
import { PaperMarket } from '../domain/paper-account.type';
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
  decidedCount: 0,
  filledCount: 0,
  fillFailureCount: 0,
  fills: [],
  skippedByPendingSell: 0,
  skippedByNoPosition: 0,
  accountFailureCount: 0,
  accountFailures: [],
});

const findTodayBar = (bars: DailyBar[], tradeDate: string): DailyBar | null => {
  const bar = bars.find(
    (candidate) => candidate.tradeDate.toISOString().slice(0, 10) === tradeDate,
  );
  return bar ?? null;
};

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
    const stopLossPercent =
      command.stopLossPercent ?? DEFAULT_STOP_LOSS_PERCENT;
    const tradeDay = new Date(`${tradeDate}T00:00:00.000Z`);

    for (const account of accounts) {
      try {
        await this.applyToAccount({
          account,
          command,
          stopLossPercent,
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
    stopLossPercent: number;
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
      input.stopLossPercent,
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
      threshold: {
        takeProfitPercent: DEFAULT_TAKE_PROFIT_PERCENT,
        stopLossPercent: input.stopLossPercent,
      },
      orders: decisions.map((decision) => ({
        tickerId: decision.tickerId,
        reason: describeIntradayStopReason(decision, input.stopLossPercent),
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
        bars = await this.marketData.fetchDailyBars(
          position.ticker.tossSymbol,
          1,
          { adjusted: false },
        );
      } catch {
        result.priceErrorCount += 1;
        continue;
      }
      // 오늘 봉이 없는 것은 장애가 아니다 — 휴장이거나 그 종목만 거래정지다. 예외와
      // 합쳐 세면 "장이 안 열렸다" 와 "시세가 안 온다" 를 가를 수 없고, 그러면 휴장마다
      // 장애 카드가 나가거나 반대로 진짜 장애가 휴장으로 묻힌다.
      const todayBar = findTodayBar(bars, tradeDate);
      if (!todayBar) {
        result.notTradedCount += 1;
        continue;
      }
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
