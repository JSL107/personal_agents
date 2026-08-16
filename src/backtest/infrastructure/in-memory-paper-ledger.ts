import { Prisma } from '@prisma/client';

import {
  RecommendationOrderInput,
  RecommendationTradeInput,
} from '../../paper-trading/domain/recommendation-score';
import {
  FillPendingOrderInput,
  PendingOrderFillResult,
} from '../../paper-trading/infrastructure/paper-trading.prisma.repository';

interface LedgerPosition {
  id: number;
  accountId: number;
  tickerId: number;
  quantity: Prisma.Decimal;
  avgPrice: Prisma.Decimal;
}

// 실전 체결 usecase(RecordPaperTradeUsecase)를 그대로 통과시키되 DB 는 건드리지 않는다.
// 체결 로직을 새로 쓰면 현금 부족 시 수량 축소, 보유 초과 클램프, 만료 판정이 백테스트에는
// 없게 되어 "실전과 같은 것을 재는가" 가 깨진다. usecase 가 쓰는 리포지토리 메서드는
// fillPendingOrderAtomically 하나뿐이라 그것만 대역하고, 주입 시점에 호출자가 캐스팅한다.
//
// 원장은 채점기(matchRecommendationCycles)가 그대로 먹는 형태로 쌓는다. 그래야 백테스트 성적과
// 실전 성적표가 같은 자로 잰 숫자가 된다.
export class InMemoryPaperLedger {
  readonly accountId = 1;
  readonly seedAmount: Prisma.Decimal;
  cashBalance: Prisma.Decimal;
  readonly trades: RecommendationTradeInput[] = [];
  readonly orders: RecommendationOrderInput[] = [];
  private readonly positions = new Map<number, LedgerPosition>();
  private nextTradeId = 1;

  constructor(seedAmount: string) {
    this.seedAmount = new Prisma.Decimal(seedAmount);
    this.cashBalance = new Prisma.Decimal(seedAmount);
  }

  positionOf(tickerId: number): LedgerPosition | null {
    return this.positions.get(tickerId) ?? null;
  }

  openPositions(): LedgerPosition[] {
    return [...this.positions.values()].filter(
      (position) => position.quantity.comparedTo(0) > 0,
    );
  }

  recordOrder(order: RecommendationOrderInput): void {
    this.orders.push(order);
  }

  markOrderStatus(orderId: number, status: 'FILLED' | 'EXPIRED'): void {
    const order = this.orders.find((candidate) => candidate.id === orderId);
    if (order) {
      order.status = status;
    }
  }

  async fillPendingOrderAtomically(
    input: FillPendingOrderInput,
  ): Promise<PendingOrderFillResult> {
    const account = {
      id: this.accountId,
      seedAmount: this.seedAmount,
      cashBalance: this.cashBalance,
    };
    const position = this.positions.get(input.tickerId) ?? null;
    const decision = input.decide({ account, position });
    if (decision.status === 'EXPIRED') {
      this.markOrderStatus(input.orderId, 'EXPIRED');
      return decision;
    }

    this.cashBalance = new Prisma.Decimal(decision.cashBalance);
    this.positions.set(input.tickerId, {
      id: input.tickerId,
      accountId: this.accountId,
      tickerId: input.tickerId,
      quantity: new Prisma.Decimal(decision.positionQuantity),
      avgPrice: new Prisma.Decimal(decision.positionAvgPrice),
    });
    this.trades.push({
      id: this.nextTradeId,
      orderId: input.orderId,
      accountId: this.accountId,
      tickerId: input.tickerId,
      side: input.side,
      quantity: new Prisma.Decimal(decision.quantity),
      price: new Prisma.Decimal(input.price),
      fee: new Prisma.Decimal(decision.fee),
      tax: new Prisma.Decimal(decision.tax),
      realizedPnl:
        decision.realizedPnl === null
          ? null
          : new Prisma.Decimal(decision.realizedPnl),
      tradeDate: input.tradeDate,
    });
    this.nextTradeId += 1;
    this.markOrderStatus(input.orderId, 'FILLED');
    return decision;
  }
}
