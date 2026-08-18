import { Prisma } from '@prisma/client';

import { RecordPaperTradeUsecase } from '../../paper-trading/application/record-paper-trade.usecase';
import { PaperTradingPrismaRepository } from '../../paper-trading/infrastructure/paper-trading.prisma.repository';
import { InMemoryPaperLedger } from './in-memory-paper-ledger';

const usecaseOf = (ledger: InMemoryPaperLedger): RecordPaperTradeUsecase =>
  new RecordPaperTradeUsecase(
    ledger as unknown as PaperTradingPrismaRepository,
  );

const buyCommand = {
  orderId: 1,
  accountId: 1,
  tickerId: 11,
  market: 'KOSPI' as const,
  side: 'BUY' as const,
  requestedQuantity: '10',
  price: '10000',
  tradeDate: '2026-08-14',
  strategy: 'LONG_TERM' as const,
};

describe('InMemoryPaperLedger', () => {
  it('실전 체결 usecase 를 통과시켜 현금과 보유를 갱신한다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);

    const fill = await usecase.executePendingOrder(buyCommand);

    expect(fill.status).toBe('FILLED');
    expect(ledger.positionOf(11)?.quantity.toString()).toBe('10');
    expect(ledger.cashBalance.comparedTo(new Prisma.Decimal('10000000'))).toBe(
      -1,
    );
    expect(ledger.trades).toHaveLength(1);
  });

  it('현금이 모자라면 실전 로직대로 수량이 줄어든다', async () => {
    const ledger = new InMemoryPaperLedger('100000');
    const usecase = usecaseOf(ledger);

    const fill = await usecase.executePendingOrder({
      ...buyCommand,
      requestedQuantity: '100',
    });

    expect(fill.status).toBe('FILLED');
    expect(Number(ledger.positionOf(11)!.quantity.toString())).toBeLessThan(
      100,
    );
    expect(ledger.cashBalance.comparedTo(0)).toBeGreaterThanOrEqual(0);
  });

  it('보유하지 않은 종목 매도는 만료된다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);

    const fill = await usecase.executePendingOrder({
      ...buyCommand,
      tickerId: 99,
      side: 'SELL',
    });

    expect(fill.status).toBe('EXPIRED');
  });

  it('매도 체결은 실현손익을 원장에 남긴다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);
    await usecase.executePendingOrder(buyCommand);

    const fill = await usecase.executePendingOrder({
      ...buyCommand,
      orderId: 2,
      side: 'SELL',
      price: '12000',
      tradeDate: '2026-08-17',
    });

    expect(fill.status).toBe('FILLED');
    expect(ledger.positionOf(11)!.quantity.comparedTo(0)).toBe(0);
    expect(ledger.trades[1].realizedPnl).not.toBeNull();
    expect(Number(ledger.trades[1].realizedPnl!.toString())).toBeGreaterThan(0);
  });

  // 채점기(matchRecommendationCycles)가 주문 상태로 사이클을 분류하므로,
  // 체결·만료가 주문에 반영되지 않으면 성적이 통째로 어긋난다.
  it('주문 상태를 체결·만료 결과에 맞춰 갱신한다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);
    ledger.recordOrder({
      id: 1,
      accountId: 1,
      tickerId: 11,
      side: 'BUY',
      strategy: 'LONG_TERM',
      status: 'PENDING',
      quantity: new Prisma.Decimal('10'),
    });
    ledger.recordOrder({
      id: 2,
      accountId: 1,
      tickerId: 99,
      side: 'SELL',
      strategy: 'LONG_TERM',
      status: 'PENDING',
      quantity: new Prisma.Decimal('10'),
    });

    await usecase.executePendingOrder(buyCommand);
    await usecase.executePendingOrder({
      ...buyCommand,
      orderId: 2,
      tickerId: 99,
      side: 'SELL',
    });

    expect(ledger.orders[0].status).toBe('FILLED');
    expect(ledger.orders[1].status).toBe('EXPIRED');
  });

  it('수량이 0 이 된 보유는 미결제 목록에서 빠진다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);
    await usecase.executePendingOrder(buyCommand);
    expect(ledger.openPositions()).toHaveLength(1);

    await usecase.executePendingOrder({
      ...buyCommand,
      orderId: 2,
      side: 'SELL',
      price: '12000',
      tradeDate: '2026-08-17',
    });

    expect(ledger.openPositions()).toHaveLength(0);
  });
});
