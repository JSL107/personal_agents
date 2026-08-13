import { Inject, Injectable } from '@nestjs/common';

import { DailyBar } from '../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import { PaperMarket } from '../domain/paper-account.type';
import {
  DuePaperOrderRecord,
  PaperTradingRepository,
} from '../infrastructure/paper-trading.repository';
import { RecordPaperTradeUsecase } from './record-paper-trade.usecase';

export type FillWindow = 'BEFORE_OPEN' | 'TRADING' | 'AFTER_CLOSE';

export interface FillPendingOrdersResult {
  window: FillWindow;
  attempted: number;
  filled: number;
  expired: number;
  lookupFailure: number;
  notYetTraded: number;
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

@Injectable()
export class FillPendingOrdersUsecase {
  constructor(
    private readonly repository: PaperTradingRepository,
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly recordTrade: RecordPaperTradeUsecase,
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
      };
    }
    if (minutes > closeMinutes) {
      const closeResult = await this.repository.expireDuePendingOrders(
        day,
        '체결가 조회 실패',
      );
      return {
        window: 'AFTER_CLOSE',
        attempted: closeResult.attempted,
        filled: 0,
        expired: closeResult.expired,
        lookupFailure: 0,
        notYetTraded: 0,
      };
    }

    const orders = await this.repository.findDuePendingOrders(day);
    const result: FillPendingOrdersResult = {
      window: 'TRADING',
      attempted: orders.length,
      filled: 0,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 0,
    };
    for (const order of orders) {
      await this.fillOrder(order, tradeDate, result);
    }
    return result;
  }

  private async fillOrder(
    order: DuePaperOrderRecord,
    tradeDate: string,
    result: FillPendingOrdersResult,
  ): Promise<void> {
    let bars: DailyBar[];
    try {
      bars = await this.marketData.fetchDailyBars(order.tossSymbol, 1, {
        adjusted: false,
      });
    } catch {
      result.lookupFailure += 1;
      return;
    }
    const todayBar = findTodayBar(bars, tradeDate);
    if (!todayBar) {
      result.notYetTraded += 1;
      return;
    }
    if (!todayBar.open) {
      result.lookupFailure += 1;
      return;
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
      }
      return;
    }
    const fill = await this.recordTrade.executePendingOrder({
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
    } else if (fill.status === 'EXPIRED') {
      result.expired += 1;
    }
  }
}
