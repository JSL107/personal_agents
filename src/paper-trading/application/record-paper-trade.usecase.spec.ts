import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import {
  RecordPaperTradeUsecase,
  RecordTradeCommand,
} from './record-paper-trade.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const defaultCommand: RecordTradeCommand = {
  accountName: 'DEFAULT',
  tickerCode: '005930',
  tickerName: '삼성전자',
  market: 'KOSPI',
  side: 'BUY',
  quantity: '10',
  price: '10000',
  tradeDate: '2026-08-11',
  strategy: 'MANUAL',
};

interface RepositoryFixture {
  usecase: RecordPaperTradeUsecase;
  transaction: {
    paperAccount: { update: jest.Mock };
    paperOrder: { create: jest.Mock };
    paperPosition: { findUnique: jest.Mock; upsert: jest.Mock };
    paperTrade: { findUnique: jest.Mock; create: jest.Mock };
  };
  prisma: {
    paperAccount: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    ticker: { upsert: jest.Mock };
    paperPosition: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    paperTrade: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
}

const createFixture = (input?: {
  rootCashBalance?: string;
  cashBalance?: string;
  positionQuantity?: string;
  positionAvgPrice?: string;
}): RepositoryFixture => {
  const transaction = {
    paperOrder: {
      create: jest.fn().mockResolvedValue({ id: 701 }),
    },
    paperTrade: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 91 }),
    },
    paperPosition: {
      findUnique: jest.fn().mockResolvedValue(
        input?.positionQuantity === undefined
          ? null
          : {
              id: 31,
              accountId: 11,
              tickerId: 21,
              quantity: decimal(input.positionQuantity),
              avgPrice: decimal(input.positionAvgPrice ?? '0'),
            },
      ),
      upsert: jest.fn().mockResolvedValue({ id: 31 }),
    },
    paperAccount: {
      update: jest.fn().mockImplementation(async (argument) => {
        if (argument.data.cashBalance?.increment === 0) {
          return {
            id: 11,
            seedAmount: decimal('1000000'),
            cashBalance: decimal(input?.cashBalance ?? '1000000'),
          };
        }
        return { id: 11 };
      }),
    },
  };
  const prisma = {
    paperAccount: {
      findUnique: jest.fn().mockResolvedValue({
        id: 11,
        seedAmount: decimal('1000000'),
        cashBalance: decimal(input?.rootCashBalance ?? '1000000'),
      }),
      update: jest.fn(),
    },
    ticker: {
      upsert: jest.fn().mockResolvedValue({ id: 21 }),
    },
    paperPosition: {
      findUnique: jest.fn().mockResolvedValue(
        input?.positionQuantity === undefined
          ? null
          : {
              id: 31,
              accountId: 11,
              tickerId: 21,
              quantity: decimal(input.positionQuantity),
              avgPrice: decimal(input.positionAvgPrice ?? '0'),
            },
      ),
      upsert: jest.fn(),
    },
    paperTrade: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
  const repository = new PaperTradingPrismaRepository(
    prisma as unknown as PrismaService,
  );

  return {
    usecase: new RecordPaperTradeUsecase(repository),
    transaction,
    prisma,
  };
};

describe('RecordPaperTradeUsecase', () => {
  it('매수 대금과 비용을 현금에서 차감하고 포지션을 생성한다', async () => {
    const { usecase, prisma, transaction } = createFixture();

    const result = await usecase.execute(defaultCommand);

    expect(result).toEqual({
      tradeId: 91,
      cashBalance: '899982',
      positionQuantity: '10',
      positionAvgPrice: '10001.8',
      realizedPnl: null,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.paperAccount.update).toHaveBeenNthCalledWith(1, {
      where: { id: 11 },
      data: { cashBalance: { increment: 0 } },
      select: { id: true, seedAmount: true, cashBalance: true },
    });
    expect(transaction.paperOrder.create).toHaveBeenCalledWith({
      data: {
        accountId: 11,
        tickerId: 21,
        side: 'BUY',
        quantity: '10',
        strategy: 'MANUAL',
        reason: null,
        decidedAt: expect.any(Date),
        dataAsOf: new Date('2026-08-11T00:00:00.000Z'),
        targetTradeDate: new Date('2026-08-11T00:00:00.000Z'),
        status: 'FILLED',
        agentRunId: null,
      },
      select: { id: true },
    });
    expect(transaction.paperTrade.findUnique).toHaveBeenCalledWith({
      where: { fingerprint: '11:21:2026-08-11:BUY:10:10000:701' },
      select: { id: true },
    });
    expect(transaction.paperPosition.findUnique).toHaveBeenCalledWith({
      where: { accountId_tickerId: { accountId: 11, tickerId: 21 } },
      select: {
        id: true,
        accountId: true,
        tickerId: true,
        quantity: true,
        avgPrice: true,
      },
    });
    expect(transaction.paperTrade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 11,
        tickerId: 21,
        orderId: 701,
        fingerprint: '11:21:2026-08-11:BUY:10:10000:701',
        fee: '18',
        tax: '0',
      }),
      select: { id: true },
    });
    expect(transaction.paperPosition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          quantity: '10',
          avgPrice: '10001.8',
        }),
      }),
    );
    expect(transaction.paperAccount.update).toHaveBeenNthCalledWith(2, {
      where: { id: 11 },
      data: { cashBalance: '899982' },
    });
    expect(prisma.paperTrade.create).not.toHaveBeenCalled();
    expect(prisma.paperPosition.upsert).not.toHaveBeenCalled();
    expect(prisma.paperAccount.update).not.toHaveBeenCalled();
    expect(prisma.paperPosition.findUnique).not.toHaveBeenCalled();
  });

  it('transaction에서 잠근 최신 현금이 부족하면 어떤 원장 쓰기도 하지 않는다', async () => {
    const { usecase, prisma, transaction } = createFixture({
      rootCashBalance: '1000000',
      cashBalance: '100000',
    });

    await expect(
      usecase.execute({ ...defaultCommand, quantity: '11' }),
    ).rejects.toThrow('현금 잔액이 부족합니다');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transaction.paperTrade.create).not.toHaveBeenCalled();
    expect(transaction.paperPosition.upsert).not.toHaveBeenCalled();
    expect(transaction.paperAccount.update).toHaveBeenCalledTimes(1);
  });

  it('국내 주식 소수 수량을 거부한다', async () => {
    const { usecase, prisma } = createFixture();

    await expect(
      usecase.execute({ ...defaultCommand, quantity: '1.5' }),
    ).rejects.toThrow('국내 주식 수량은 정수여야 합니다');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('매도 순수취액을 현금에 더하고 실현손익을 기록한다', async () => {
    const { usecase, transaction } = createFixture({
      cashBalance: '899982',
      positionQuantity: '10',
      positionAvgPrice: '10001.8',
    });

    const result = await usecase.execute({
      ...defaultCommand,
      side: 'SELL',
      quantity: '4',
      price: '12000',
      tradeDate: '2026-08-12',
    });

    expect(result).toEqual({
      tradeId: 91,
      cashBalance: '947878',
      positionQuantity: '6',
      positionAvgPrice: '10001.8',
      realizedPnl: '7888.8',
    });
    expect(transaction.paperTrade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        side: 'SELL',
        fee: '8',
        tax: '96',
        realizedPnl: '7888.8',
      }),
      select: { id: true },
    });
  });

  it('전량 매도하면 포지션 수량을 0으로 저장한다', async () => {
    const { usecase, transaction } = createFixture({
      cashBalance: '899982',
      positionQuantity: '10',
      positionAvgPrice: '10001.8',
    });

    const result = await usecase.execute({
      ...defaultCommand,
      side: 'SELL',
      price: '12000',
      tradeDate: '2026-08-12',
    });

    expect(result.positionQuantity).toBe('0');
    expect(transaction.paperPosition.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: '0', avgPrice: '10001.8' },
      }),
    );
  });

  it('같은 자동 주문 체결을 재시도하면 한국어 중복 오류로 거부한다', async () => {
    const { usecase, prisma, transaction } = createFixture();
    await usecase.execute({ ...defaultCommand, orderId: 701 });
    transaction.paperAccount.update.mockImplementation(async (argument) => {
      if (argument.data.cashBalance?.increment === 0) {
        return {
          id: 11,
          seedAmount: decimal('1000000'),
          cashBalance: decimal('0'),
        };
      }
      return { id: 11 };
    });
    transaction.paperTrade.findUnique.mockResolvedValue({ id: 91 });
    transaction.paperPosition.findUnique.mockResolvedValue(null);

    await expect(
      usecase.execute({ ...defaultCommand, orderId: 701 }),
    ).rejects.toThrow('이미 기록된 가상 매매입니다');
    expect(transaction.paperTrade.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        fingerprint: '11:21:2026-08-11:BUY:10:10000:701',
      }),
      select: { id: true },
    });
    expect(transaction.paperTrade.create).toHaveBeenCalledTimes(1);
    expect(transaction.paperPosition.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.paperTrade.findUnique).not.toHaveBeenCalled();
  });

  it('동시 요청이 사전조회 뒤 경합하면 P2002를 한국어 중복 오류로 변환한다', async () => {
    const { usecase, transaction } = createFixture();
    transaction.paperTrade.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      usecase.execute({ ...defaultCommand, orderId: 701 }),
    ).rejects.toThrow('이미 기록된 가상 매매입니다');
  });

  it('Ticker identity를 KR/TOSS로 고정하고 이름이 없으면 종목코드를 쓴다', async () => {
    const { usecase, prisma } = createFixture();

    await usecase.execute({ ...defaultCommand, tickerName: undefined });

    expect(prisma.ticker.upsert).toHaveBeenCalledWith({
      where: { market_code: { market: 'KR', code: '005930' } },
      create: {
        code: '005930',
        market: 'KR',
        marketCountry: 'KR',
        tossSymbol: '005930',
        name: '005930',
        currency: 'KRW',
        source: 'TOSS',
      },
      update: {
        marketCountry: 'KR',
        tossSymbol: '005930',
        currency: 'KRW',
        source: 'TOSS',
      },
      select: { id: true },
    });
  });

  it('orderId가 있으면 같은 체결 조건도 서로 다른 fingerprint로 구분한다', async () => {
    const { usecase, transaction } = createFixture();

    await usecase.execute({ ...defaultCommand, orderId: 701 });
    await usecase.execute({ ...defaultCommand, orderId: 702 });

    expect(transaction.paperTrade.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        orderId: 701,
        fingerprint: '11:21:2026-08-11:BUY:10:10000:701',
      }),
      select: { id: true },
    });
    expect(transaction.paperTrade.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        orderId: 702,
        fingerprint: '11:21:2026-08-11:BUY:10:10000:702',
      }),
      select: { id: true },
    });
    expect(transaction.paperOrder.create).not.toHaveBeenCalled();
  });

  it('수동 CLI의 동일 조건 체결은 호출마다 새 주문과 fingerprint로 기록한다', async () => {
    const { usecase, transaction } = createFixture();
    transaction.paperOrder.create
      .mockResolvedValueOnce({ id: 701 })
      .mockResolvedValueOnce({ id: 702 });

    await usecase.execute({ ...defaultCommand, reason: '첫 번째 판단' });
    await usecase.execute({ ...defaultCommand, reason: '두 번째 판단' });

    expect(transaction.paperOrder.create).toHaveBeenCalledTimes(2);
    expect(transaction.paperOrder.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ reason: '첫 번째 판단' }),
      }),
    );
    expect(transaction.paperOrder.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ reason: '두 번째 판단' }),
      }),
    );
    expect(transaction.paperTrade.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        orderId: 701,
        fingerprint: '11:21:2026-08-11:BUY:10:10000:701',
      }),
      select: { id: true },
    });
    expect(transaction.paperTrade.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        orderId: 702,
        fingerprint: '11:21:2026-08-11:BUY:10:10000:702',
      }),
      select: { id: true },
    });
  });
});
