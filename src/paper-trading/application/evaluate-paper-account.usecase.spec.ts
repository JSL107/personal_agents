import { Prisma } from '@prisma/client';

import { DailyBar } from '../../market-data/domain/market-data.type';
import { MarketDataPort } from '../../market-data/domain/port/market-data.port';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperTradingRepository } from '../infrastructure/paper-trading.repository';
import { EvaluatePaperAccountUsecase } from './evaluate-paper-account.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const createBar = (tradeDate: string, close: string): DailyBar => ({
  tradeDate: date(tradeDate),
  close: decimal(close),
  adjClose: decimal(close),
  volume: BigInt(1000),
  currency: 'KRW',
});

const createPosition = (input: {
  tickerId: number;
  code: string;
  quantity: string;
  avgPrice: string;
}) => ({
  id: input.tickerId + 100,
  accountId: 11,
  tickerId: input.tickerId,
  quantity: decimal(input.quantity),
  avgPrice: decimal(input.avgPrice),
  ticker: {
    id: input.tickerId,
    code: input.code,
    market: 'KR',
    marketCountry: 'KR',
    yahooSymbol: null,
    tossSymbol: input.code,
    name: input.code,
    currency: 'KRW',
    exposureRegion: null,
    exposureDirection: 'LONG',
    source: 'TOSS',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
});

const createBuyTrade = (input: {
  tickerId: number;
  quantity: string;
  price: string;
}) => ({
  side: 'BUY',
  quantity: decimal(input.quantity),
  price: decimal(input.price),
  fee: decimal('0'),
  tax: decimal('0'),
  tickerId: input.tickerId,
});

interface EvaluationFixture {
  usecase: EvaluatePaperAccountUsecase;
  marketData: { fetchDailyBars: jest.Mock };
  prisma: {
    $transaction: jest.Mock;
    paperTrade: { findMany: jest.Mock };
    paperEquitySnapshot: {
      upsert: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    paperPositionSnapshot: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    dailyPrice: {
      upsert: jest.Mock;
      create: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  snapshotTransaction: {
    paperAccount: { update: jest.Mock };
    paperPosition: { findMany: jest.Mock };
    paperTrade: { findMany: jest.Mock };
    paperEquitySnapshot: { upsert: jest.Mock };
    paperPositionSnapshot: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
  };
}

const createFixture = (input?: {
  seedAmount?: string;
  cashBalance?: string;
  positions?: ReturnType<typeof createPosition>[];
  trades?: ReturnType<typeof createBuyTrade>[];
  barsBySymbol?: Record<string, DailyBar[]>;
  errorsBySymbol?: Record<string, Error>;
}): EvaluationFixture => {
  const positions = input?.positions ?? [];
  const trades = input?.trades ?? [];
  const snapshotTransaction = {
    paperAccount: {
      update: jest.fn().mockResolvedValue({
        id: 11,
        seedAmount: decimal(input?.seedAmount ?? '1000000'),
        cashBalance: decimal(input?.cashBalance ?? '1000000'),
      }),
    },
    paperPosition: {
      findMany: jest.fn().mockResolvedValue(positions),
    },
    paperTrade: {
      findMany: jest.fn().mockResolvedValue(trades),
    },
    paperEquitySnapshot: {
      upsert: jest.fn().mockResolvedValue({ id: 301 }),
    },
    paperPositionSnapshot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: positions.length }),
    },
  };
  const prisma = {
    paperAccount: {
      findUnique: jest.fn().mockResolvedValue({
        id: 11,
        seedAmount: decimal(input?.seedAmount ?? '1000000'),
        cashBalance: decimal(input?.cashBalance ?? '1000000'),
      }),
    },
    paperPosition: {
      findMany: jest.fn().mockResolvedValue(positions),
    },
    paperTrade: {
      findMany: jest.fn().mockResolvedValue(trades),
    },
    paperEquitySnapshot: {
      upsert: snapshotTransaction.paperEquitySnapshot.upsert,
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    paperPositionSnapshot: {
      deleteMany: snapshotTransaction.paperPositionSnapshot.deleteMany,
      createMany: snapshotTransaction.paperPositionSnapshot.createMany,
    },
    dailyPrice: {
      upsert: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(
      async (
        callback: (client: typeof snapshotTransaction) => Promise<unknown>,
      ) => callback(snapshotTransaction),
    ),
  };
  const marketData = {
    fetchDailyBars: jest.fn(async (symbol: string) => {
      const error = input?.errorsBySymbol?.[symbol];
      if (error) {
        throw error;
      }
      return input?.barsBySymbol?.[symbol] ?? [];
    }),
    fetchUsdKrwRate: jest.fn(),
  };
  const repository = new PaperTradingRepository(
    prisma as unknown as PrismaService,
  );

  return {
    usecase: new EvaluatePaperAccountUsecase(
      repository,
      marketData as MarketDataPort,
    ),
    marketData,
    prisma,
    snapshotTransaction,
  };
};

describe('EvaluatePaperAccountUsecase', () => {
  it('포지션 2건을 각각 최신 종가로 평가해 계좌 총액을 합산한다', async () => {
    const positions = [
      createPosition({
        tickerId: 21,
        code: '005930',
        quantity: '10',
        avgPrice: '10000',
      }),
      createPosition({
        tickerId: 22,
        code: '000660',
        quantity: '2',
        avgPrice: '50000',
      }),
    ];
    const { usecase, prisma } = createFixture({
      cashBalance: '800000',
      positions,
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
        createBuyTrade({ tickerId: 22, quantity: '2', price: '50000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
        '000660': [
          createBar('2026-08-10', '55000'),
          createBar('2026-08-11', '60000'),
        ],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result).toEqual({
      skipped: false,
      tradeDate: '2026-08-11',
      cashBalance: '800000',
      positionValue: '240000',
      totalValue: '1040000',
      returnRate: '4',
      benchmarkClose: null,
      positions: [
        {
          tickerId: 21,
          tickerCode: '005930',
          tickerName: '005930',
          quantity: '10',
          avgPrice: '10000',
          price: '12000',
          priceDate: '2026-08-11',
          marketValue: '120000',
          unrealizedPnl: '20000',
          returnRate: '20',
          isStale: false,
        },
        {
          tickerId: 22,
          tickerCode: '000660',
          tickerName: '000660',
          quantity: '2',
          avgPrice: '50000',
          price: '60000',
          priceDate: '2026-08-11',
          marketValue: '120000',
          unrealizedPnl: '20000',
          returnRate: '20',
          isStale: false,
        },
      ],
      unpricedPositions: [],
      positionCount: 2,
      staleTickerCount: 0,
      invariantViolations: [],
      suspiciousJumps: [],
    });
    expect(prisma.paperEquitySnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          positionValue: '240000',
          totalValue: '1040000',
        }),
      }),
    );
  });

  it('포지션 0건도 KST 실행일에 현금 스냅샷을 적재한다', async () => {
    const { usecase, prisma } = createFixture();

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T15:30:00.000Z'),
    });

    expect(result).toEqual({
      skipped: false,
      tradeDate: '2026-08-12',
      cashBalance: '1000000',
      positionValue: '0',
      totalValue: '1000000',
      returnRate: '0',
      benchmarkClose: null,
      positions: [],
      unpricedPositions: [],
      positionCount: 0,
      staleTickerCount: 0,
      invariantViolations: [],
      suspiciousJumps: [],
    });
    expect(prisma.paperEquitySnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountId_tradeDate: { accountId: 11, tradeDate: date('2026-08-12') },
        },
        create: expect.objectContaining({
          cashBalance: '1000000',
          positionValue: '0',
          totalValue: '1000000',
        }),
      }),
    );
    expect(prisma.paperPositionSnapshot.createMany).not.toHaveBeenCalled();
  });

  it('봉 거래일이 KST 실행일과 다르면 stale로 표시하고 마지막 종가로 평가한다', async () => {
    const positions = [
      createPosition({
        tickerId: 21,
        code: '005930',
        quantity: '10',
        avgPrice: '10000',
      }),
      createPosition({
        tickerId: 22,
        code: '000660',
        quantity: '2',
        avgPrice: '50000',
      }),
    ];
    const { usecase, prisma } = createFixture({
      cashBalance: '800000',
      positions,
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
        createBuyTrade({ tickerId: 22, quantity: '2', price: '50000' }),
      ],
      barsBySymbol: {
        '005930': [createBar('2026-08-10', '11000')],
        '000660': [
          createBar('2026-08-10', '55000'),
          createBar('2026-08-11', '60000'),
        ],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(false);
    expect(result.staleTickerCount).toBe(1);
    expect(prisma.paperPositionSnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          tickerId: 21,
          price: '11000',
          priceDate: date('2026-08-10'),
          isStale: true,
        }),
      ]),
    });
  });

  it('시세를 받지 못한 종목이 하나라도 있으면 부분 합계를 적재하지 않고 근거를 반환한다', async () => {
    const positions = [
      createPosition({
        tickerId: 21,
        code: '005930',
        quantity: '10',
        avgPrice: '10000',
      }),
      createPosition({
        tickerId: 22,
        code: '000660',
        quantity: '2',
        avgPrice: '50000',
      }),
    ];
    const { usecase, prisma } = createFixture({
      cashBalance: '800000',
      positions,
      barsBySymbol: {
        '005930': [createBar('2026-08-11', '12000')],
        '000660': [],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result).toEqual(
      expect.objectContaining({
        skipped: true,
        skipReason: '1개 보유 종목의 평가 시세를 찾을 수 없습니다: 000660',
        cashBalance: '800000',
        positionValue: null,
        totalValue: null,
        returnRate: null,
        positions: [
          expect.objectContaining({
            tickerId: 21,
            tickerCode: '005930',
            price: '12000',
            marketValue: '120000',
          }),
        ],
        unpricedPositions: [
          {
            tickerId: 22,
            tickerCode: '000660',
            tickerName: '000660',
            quantity: '2',
            avgPrice: '50000',
          },
        ],
      }),
    );
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('종목 시세 조회가 실패해도 unpriced로 분류하고 부분 스냅샷을 적재하지 않는다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma } = createFixture({
      cashBalance: '900000',
      positions: [position],
      errorsBySymbol: { '005930': new Error('upstream timeout') },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(true);
    expect(result.unpricedPositions).toEqual([
      expect.objectContaining({ tickerId: 21, tickerCode: '005930' }),
    ]);
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
  });

  it('휴장일처럼 모든 포지션이 stale이면 다른 검증 전에 스냅샷을 건너뛴다', async () => {
    const positions = [
      createPosition({
        tickerId: 21,
        code: '005930',
        quantity: '10',
        avgPrice: '10000',
      }),
      createPosition({
        tickerId: 22,
        code: '000660',
        quantity: '2',
        avgPrice: '50000',
      }),
    ];
    const { usecase, prisma } = createFixture({
      cashBalance: '123',
      positions,
      barsBySymbol: {
        '005930': [createBar('2026-08-08', '5000')],
        '000660': [createBar('2026-08-08', '25000')],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-09T08:40:00.000Z'),
    });

    expect(result).toEqual({
      skipped: true,
      skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
      tradeDate: '2026-08-09',
      cashBalance: '123',
      positionValue: null,
      totalValue: null,
      returnRate: null,
      benchmarkClose: null,
      positions: [
        expect.objectContaining({
          tickerId: 21,
          tickerCode: '005930',
          price: '5000',
          marketValue: '50000',
          unrealizedPnl: '-50000',
          returnRate: '-50',
          isStale: true,
        }),
        expect.objectContaining({
          tickerId: 22,
          tickerCode: '000660',
          price: '25000',
          marketValue: '50000',
          unrealizedPnl: '-50000',
          returnRate: '-50',
          isStale: true,
        }),
      ],
      unpricedPositions: [],
      positionCount: 2,
      staleTickerCount: 2,
      invariantViolations: [],
      suspiciousJumps: [],
    });
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.paperTrade.findMany).not.toHaveBeenCalled();
  });

  it('불변식 위반이면 스냅샷을 적재하지 않는다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma } = createFixture({
      positions: [position],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(true);
    expect(result.cashBalance).toBe('1000000');
    expect(result.positions).toEqual([
      expect.objectContaining({
        tickerId: 21,
        tickerCode: '005930',
        quantity: '10',
        price: '12000',
      }),
    ]);
    expect(result.invariantViolations).toEqual([
      '종목 21 수량 불일치: 원장 기준 0주, 실제 10주',
    ]);
    expect(result.suspiciousJumps).toEqual([]);
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
  });

  it('분할 의심 가격 점프가 있으면 불변식 검사 전에 스냅샷을 차단한다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma } = createFixture({
      cashBalance: '123',
      positions: [position],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '10000'),
          createBar('2026-08-11', '5000'),
        ],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(true);
    expect(result.cashBalance).toBe('123');
    expect(result.positions).toEqual([
      expect.objectContaining({
        tickerId: 21,
        tickerCode: '005930',
        quantity: '10',
        price: '5000',
      }),
    ]);
    expect(result.suspiciousJumps).toEqual([
      '종목 21 가격 비정상 점프: 전일 대비 0.5배 (2:1 분할 의심)',
    ]);
    expect(result.invariantViolations).toEqual([]);
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
    expect(prisma.paperTrade.findMany).not.toHaveBeenCalled();
  });

  it('같은 KST 거래일 재실행은 총계와 포지션 스냅샷을 단일 transaction에서 덮어쓴다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma } = createFixture({
      cashBalance: '900000',
      positions: [position],
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });

    await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });
    await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T09:10:00.000Z'),
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.paperEquitySnapshot.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          accountId_tradeDate: { accountId: 11, tradeDate: date('2026-08-11') },
        },
        create: expect.objectContaining({
          totalValue: '1020000',
          isBackfilled: false,
        }),
        update: expect.objectContaining({
          totalValue: '1020000',
          isBackfilled: false,
        }),
      }),
    );
    expect(prisma.paperPositionSnapshot.deleteMany).toHaveBeenCalledTimes(2);
    expect(prisma.paperPositionSnapshot.deleteMany).toHaveBeenNthCalledWith(2, {
      where: { snapshotId: 301 },
    });
    expect(prisma.paperPositionSnapshot.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.paperPositionSnapshot.createMany).toHaveBeenNthCalledWith(2, {
      data: [expect.objectContaining({ snapshotId: 301, tickerId: 21 })],
    });
  });

  it('모든 종목 시세를 최신과 직전 2봉, 미조정 가격으로 조회한다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, marketData } = createFixture({
      cashBalance: '900000',
      positions: [position],
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });

    await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(marketData.fetchDailyBars).toHaveBeenCalledWith('005930', 2, {
      adjusted: false,
    });
  });

  it('공유 rate limiter가 경쟁하지 않도록 종목 시세를 순차 조회한다', async () => {
    const positions = [
      createPosition({
        tickerId: 21,
        code: '005930',
        quantity: '10',
        avgPrice: '10000',
      }),
      createPosition({
        tickerId: 22,
        code: '000660',
        quantity: '2',
        avgPrice: '50000',
      }),
    ];
    const { usecase, marketData } = createFixture({
      cashBalance: '800000',
      positions,
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
        createBuyTrade({ tickerId: 22, quantity: '2', price: '50000' }),
      ],
    });
    let activeRequestCount = 0;
    let maximumActiveRequestCount = 0;
    marketData.fetchDailyBars.mockImplementation(async () => {
      activeRequestCount += 1;
      maximumActiveRequestCount = Math.max(
        maximumActiveRequestCount,
        activeRequestCount,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeRequestCount -= 1;
      return [
        createBar('2026-08-10', '10000'),
        createBar('2026-08-11', '11000'),
      ];
    });

    await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(maximumActiveRequestCount).toBe(1);
  });

  it('저장 직전 포지션 종목 집합이 달라지면 스냅샷을 적재하지 않는다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma, snapshotTransaction } = createFixture({
      cashBalance: '900000',
      positions: [position],
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });
    snapshotTransaction.paperPosition.findMany.mockResolvedValue([
      position,
      createPosition({
        tickerId: 22,
        code: '000660',
        quantity: '1',
        avgPrice: '50000',
      }),
    ]);

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('시세 조회 중 계좌 상태가 변경');
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
  });

  it('저장 직전 현금만 달라져도 스냅샷을 적재하지 않는다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma, snapshotTransaction } = createFixture({
      cashBalance: '900000',
      positions: [position],
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });
    snapshotTransaction.paperAccount.update.mockResolvedValue({
      id: 11,
      seedAmount: decimal('1000000'),
      cashBalance: decimal('899999'),
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('시세 조회 중 계좌 상태가 변경');
    expect(prisma.paperEquitySnapshot.upsert).not.toHaveBeenCalled();
  });

  it('저장 직전 포지션 종목 집합과 현금이 같으면 정상 적재한다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma } = createFixture({
      cashBalance: '900000',
      positions: [position],
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(false);
    expect(prisma.paperEquitySnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it('평가 중 DailyPrice를 읽거나 쓰지 않는다', async () => {
    const position = createPosition({
      tickerId: 21,
      code: '005930',
      quantity: '10',
      avgPrice: '10000',
    });
    const { usecase, prisma } = createFixture({
      cashBalance: '900000',
      positions: [position],
      trades: [
        createBuyTrade({ tickerId: 21, quantity: '10', price: '10000' }),
      ],
      barsBySymbol: {
        '005930': [
          createBar('2026-08-10', '11000'),
          createBar('2026-08-11', '12000'),
        ],
      },
    });

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      executedAt: new Date('2026-08-11T08:40:00.000Z'),
    });

    expect(result.skipped).toBe(false);
    expect(prisma.paperEquitySnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.dailyPrice.upsert).not.toHaveBeenCalled();
    expect(prisma.dailyPrice.create).not.toHaveBeenCalled();
    expect(prisma.dailyPrice.createMany).not.toHaveBeenCalled();
    expect(prisma.dailyPrice.findMany).not.toHaveBeenCalled();
    expect(prisma.dailyPrice.findFirst).not.toHaveBeenCalled();
    expect(prisma.dailyPrice.findUnique).not.toHaveBeenCalled();
  });
});
