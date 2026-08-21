import { Inject, Injectable } from '@nestjs/common';

import { DailyBar } from '../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import { PaperMarket, TradeSide } from '../domain/paper-account.type';
import {
  DuePaperOrderRecord,
  PaperTradingPrismaRepository,
} from '../infrastructure/paper-trading.prisma.repository';
import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';

export type FillWindow = 'BEFORE_OPEN' | 'TRADING' | 'AFTER_CLOSE';

export type PaperOrderFillOutcome =
  | 'FILLED'
  | 'EXPIRED'
  | 'LOOKUP_FAILURE'
  | 'NOT_YET_TRADED';

// 카운트만으로는 "무엇을 체결했는지" 가 알림에 남지 않아, 주문 단위 결과를 함께 올린다.
export interface PaperOrderFillDetail {
  accountName: string;
  tickerName: string;
  tickerCode: string;
  side: TradeSide;
  outcome: PaperOrderFillOutcome;
  // FILLED 는 실제 체결 수량(현금·보유 한도로 줄어들 수 있다), 그 외는 주문 수량.
  quantity: string;
  // 체결가(당일 시가). 체결되지 않은 주문은 null.
  price: string | null;
  // EXPIRED 의 만료 사유. 나머지 결과는 null.
  reason: string | null;
}

export interface FillPendingOrdersResult {
  window: FillWindow;
  attempted: number;
  filled: number;
  expired: number;
  lookupFailure: number;
  notYetTraded: number;
  details: PaperOrderFillDetail[];
  // 장 마감 후 체결가를 못 받아 한꺼번에 만료된 주문 수(종목 단위 식별 불가).
  bulkExpired: number;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const getKstClock = (date: Date): { tradeDate: string; minutes: number } => {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return {
    tradeDate: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
};

const parsePaperMarket = (value: string | null): PaperMarket | null => {
  if (value === 'KOSPI' || value === 'KOSDAQ' || value === 'KONEX') {
    return value;
  }
  return null;
};

const findTodayBar = (bars: DailyBar[], tradeDate: string): DailyBar | null =>
  bars.find((bar) => bar.tradeDate.toISOString().slice(0, 10) === tradeDate) ??
  null;

// 일괄 만료는 updateMany 라 대상 주문 id 를 돌려주지 않는다. 같은 거래일의 미체결 주문이
// 곧 그 대상이므로, 종목을 아는 만큼은 상세에서 만료로 교정하고 나머지만 건수로 보고한다.
const markUnfilledAsExpired = (details: PaperOrderFillDetail[]): number => {
  let corrected = 0;
  for (const detail of details) {
    if (
      detail.outcome === 'LOOKUP_FAILURE' ||
      detail.outcome === 'NOT_YET_TRADED'
    ) {
      detail.outcome = 'EXPIRED';
      detail.reason = '체결가 조회 실패';
      corrected += 1;
    }
  }
  return corrected;
};

const toDetail = (
  order: DuePaperOrderRecord,
  outcome: PaperOrderFillOutcome,
  overrides: { quantity?: string; price?: string; reason?: string } = {},
): PaperOrderFillDetail => ({
  accountName: order.accountName,
  tickerName: order.tickerName,
  tickerCode: order.tickerCode,
  side: order.side,
  outcome,
  quantity: overrides.quantity ?? order.quantity.toString(),
  price: overrides.price ?? null,
  reason: overrides.reason ?? null,
});

@Injectable()
export class FillPendingOrdersUsecase {
  constructor(
    private readonly repository: PaperTradingPrismaRepository,
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly executeOrder: ExecutePaperOrderUsecase,
  ) {}

  async execute(
    input: { executedAt?: Date } = {},
  ): Promise<FillPendingOrdersResult> {
    const executedAt = input.executedAt ?? new Date();
    const { tradeDate, minutes } = getKstClock(executedAt);
    const day = new Date(`${tradeDate}T00:00:00.000Z`);
    const openMinutes = 9 * 60 + 30;
    const closeMinutes = 15 * 60 + 30;
    if (minutes < openMinutes) {
      return {
        window: 'BEFORE_OPEN',
        attempted: 0,
        filled: 0,
        expired: 0,
        lookupFailure: 0,
        notYetTraded: 0,
        details: [],
        bulkExpired: 0,
      };
    }
    const window: FillWindow =
      minutes > closeMinutes ? 'AFTER_CLOSE' : 'TRADING';
    const orders = await this.repository.findDuePendingOrders(day);
    const result: FillPendingOrdersResult = {
      window,
      attempted: orders.length,
      filled: 0,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 0,
      details: [],
      bulkExpired: 0,
    };
    let sawTodayBar = false;
    for (const order of orders) {
      if (await this.fillOrder(order, tradeDate, result)) {
        sawTodayBar = true;
      }
    }
    if (window === 'AFTER_CLOSE' && sawTodayBar) {
      const closeResult = await this.repository.expireDuePendingOrders(
        day,
        '체결가 조회 실패',
      );
      result.expired += closeResult.expired;
      // 이 만료가 쓸어담는 대상이 방금 미체결로 남긴 주문들이다. 상세를 그대로 두면
      // 실제로는 취소된 주문이 "다음 회차 재시도" 로 보고된다.
      const corrected = markUnfilledAsExpired(result.details);
      result.bulkExpired += Math.max(0, closeResult.expired - corrected);
    }
    return result;
  }

  private async fillOrder(
    order: DuePaperOrderRecord,
    tradeDate: string,
    result: FillPendingOrdersResult,
  ): Promise<boolean> {
    let bars: DailyBar[];
    try {
      bars = await this.marketData.fetchDailyBars(order.tossSymbol, 1, {
        adjusted: false,
      });
    } catch {
      result.lookupFailure += 1;
      result.details.push(toDetail(order, 'LOOKUP_FAILURE'));
      return false;
    }
    const todayBar = findTodayBar(bars, tradeDate);
    if (!todayBar) {
      result.notYetTraded += 1;
      result.details.push(toDetail(order, 'NOT_YET_TRADED'));
      return false;
    }
    if (!todayBar.open) {
      result.lookupFailure += 1;
      result.details.push(toDetail(order, 'LOOKUP_FAILURE'));
      return true;
    }
    const market = parsePaperMarket(order.krxMarket);
    if (!market) {
      if (
        await this.repository.expirePendingOrder(
          order.id,
          '종목 시장 구분 없음',
        )
      ) {
        result.expired += 1;
        result.details.push(
          toDetail(order, 'EXPIRED', { reason: '종목 시장 구분 없음' }),
        );
      }
      return true;
    }
    const fill = await this.executeOrder.execute({
      orderId: order.id,
      accountId: order.accountId,
      tickerId: order.tickerId,
      market,
      side: order.side,
      requestedQuantity: order.quantity.toString(),
      price: todayBar.open.toString(),
      tradeDate,
      strategy: order.strategy,
    });
    if (fill.status === 'FILLED') {
      result.filled += 1;
      result.details.push(
        toDetail(order, 'FILLED', {
          quantity: fill.quantity,
          price: todayBar.open.toString(),
        }),
      );
    } else if (fill.status === 'EXPIRED') {
      result.expired += 1;
      result.details.push(
        toDetail(order, 'EXPIRED', { reason: fill.statusReason }),
      );
    }
    return true;
  }
}
