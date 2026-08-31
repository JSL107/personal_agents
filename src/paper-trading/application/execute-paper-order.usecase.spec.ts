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

  // 배당은 권리락일에 잔고로 잡히지만 지급일까지는 쓸 수 없다. 잔고로 재면 아직 받지도 않은
  // 돈으로 체결이 나므로, 여기가 추천이 뚫렸을 때의 마지막 방어선이다.
  it('지급일이 오지 않은 배당은 매수 수량에서 뺀다', async () => {
    const ledger = {
      fillPendingOrderAtomically: jest.fn().mockImplementation(async (input) =>
        input.decide({
          account: {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal('100000'),
            pendingDividendCash: decimal('60000'),
          },
          position: null,
        }),
      ),
    };
    const usecase = new ExecutePaperOrderUsecase(ledger);

    // 잔고 100,000 이면 9주지만 쓸 수 있는 돈은 40,000 뿐이라 3주에서 끊긴다.
    await expect(usecase.execute(command)).resolves.toEqual(
      expect.objectContaining({ status: 'FILLED', quantity: '3' }),
    );
  });

  // 백테스트 인메모리 장부는 기업행동 원장이 없어 이 값을 채우지 않는다. 그 재생이
  // 조용히 다른 수량으로 갈리면 성적 비교가 무의미해진다.
  it('미수 배당을 모르는 장부에서는 잔고가 그대로 여력이다', async () => {
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

  // 미수 배당이 잔고보다 크면 여력은 0 이다. 음수로 흘러 "살 수 있는 수량" 이 되면 안 된다.
  it('미수가 잔고보다 크면 한 주도 체결하지 않는다', async () => {
    const ledger = {
      fillPendingOrderAtomically: jest.fn().mockImplementation(async (input) =>
        input.decide({
          account: {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal('100000'),
            pendingDividendCash: decimal('130000'),
          },
          position: null,
        }),
      ),
    };
    const usecase = new ExecutePaperOrderUsecase(ledger);

    // 잔고 100,000 원이 그대로 보이는 계좌라 '현금 부족' 만으로는 왜 막혔는지 알 수 없다.
    await expect(usecase.execute(command)).resolves.toEqual({
      status: 'EXPIRED',
      statusReason: '현금 부족 (지급일 전 배당 130000원 제외)',
    });
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
