import { Prisma } from '@prisma/client';

import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('ExecutePaperOrderUsecase', () => {
  const command = {
    orderId: 701,
    accountId: 11,
    tickerId: 21,
    market: 'KOSPI' as const,
    side: 'BUY' as const,
    requestedQuantity: '11',
    price: '10000',
    tradeDate: '2026-08-13',
    strategy: 'LONG_TERM' as const,
  };

  it('transaction에서 잠근 최신 현금으로 살 수 있는 정수 수량까지 축소한다', async () => {
    const ledger = {
      fillPendingOrderAtomically: jest.fn().mockImplementation(async (input) =>
        input.decide({
          account: {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal('100000'),
          },
          position: null,
        }),
      ),
    };
    const usecase = new ExecutePaperOrderUsecase(ledger);

    await expect(usecase.execute(command)).resolves.toEqual(
      expect.objectContaining({ status: 'FILLED', quantity: '9' }),
    );
  });

  it('한 주도 살 현금이 없으면 주문을 만료한다', async () => {
    const ledger = {
      fillPendingOrderAtomically: jest.fn().mockImplementation(async (input) =>
        input.decide({
          account: {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal('1'),
          },
          position: null,
        }),
      ),
    };
    const usecase = new ExecutePaperOrderUsecase(ledger);

    await expect(usecase.execute(command)).resolves.toEqual({
      status: 'EXPIRED',
      statusReason: '현금 부족',
    });
  });

  it('매도 수량을 transaction 최신 보유 수량으로 축소한다', async () => {
    const ledger = {
      fillPendingOrderAtomically: jest.fn().mockImplementation(async (input) =>
        input.decide({
          account: {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal('100000'),
          },
          position: {
            id: 31,
            accountId: 11,
            tickerId: 21,
            quantity: decimal('4'),
            avgPrice: decimal('9000'),
          },
        }),
      ),
    };
    const usecase = new ExecutePaperOrderUsecase(ledger);

    await expect(
      usecase.execute({ ...command, side: 'SELL' }),
    ).resolves.toEqual(
      expect.objectContaining({ status: 'FILLED', quantity: '4' }),
    );
  });

  it('매도할 보유 수량이 0이면 주문을 만료한다', async () => {
    const ledger = {
      fillPendingOrderAtomically: jest.fn().mockImplementation(async (input) =>
        input.decide({
          account: {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal('100000'),
          },
          position: null,
        }),
      ),
    };
    const usecase = new ExecutePaperOrderUsecase(ledger);

    await expect(
      usecase.execute({ ...command, side: 'SELL' }),
    ).resolves.toEqual({ status: 'EXPIRED', statusReason: '보유 수량 없음' });
  });
});
