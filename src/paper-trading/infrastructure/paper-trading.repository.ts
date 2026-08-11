import { Injectable } from '@nestjs/common';

import { MoneyValue } from '../../market-data/domain/market-data.type';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperMarket, TradeSide } from '../domain/paper-account.type';

export interface PaperAccountRecord {
  id: number;
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
}

export interface PaperPositionRecord {
  id: number;
  accountId: number;
  tickerId: number;
  quantity: MoneyValue;
  avgPrice: MoneyValue;
}

export interface PaperPositionWithTicker extends PaperPositionRecord {
  ticker: {
    code: string;
    name: string;
    tossSymbol: string;
  };
}

export interface ApplyTradeInput {
  accountId: number;
  tickerId: number;
  orderId?: number;
  side: TradeSide;
  quantity: string;
  price: string;
  tradeDate: Date;
  fingerprint: string;
  calculateMutation: (state: {
    account: PaperAccountRecord;
    position: PaperPositionRecord | null;
  }) => ApplyTradeMutation;
}

export interface ApplyTradeMutation {
  fee: string;
  tax: string;
  realizedPnl: string | null;
  cashBalance: string;
  positionQuantity: string;
  positionAvgPrice: string;
}

export interface ApplyTradeResult extends ApplyTradeMutation {
  tradeId: number;
}

export interface InvariantTradeRow {
  side: TradeSide;
  quantity: MoneyValue;
  price: MoneyValue;
  fee: MoneyValue;
  tax: MoneyValue;
  tickerId: number;
}

export interface PositionSnapshotInput {
  tickerId: number;
  quantity: string;
  avgPrice: string;
  price: string;
  priceDate: Date;
  isStale: boolean;
}

export interface UpsertSnapshotInput {
  accountId: number;
  tradeDate: Date;
  cashBalance: string;
  positionValue: string;
  totalValue: string;
  returnRate: string;
  staleTickerCount: number;
  benchmarkClose?: string | null;
  positions: PositionSnapshotInput[];
}

export interface SnapshotRow {
  id: number;
  tradeDate: Date;
  totalValue: MoneyValue;
  returnRate: MoneyValue;
}

const isUniqueConstraintError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return error.code === 'P2002';
};

@Injectable()
export class PaperTradingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAccountByName(name: string): Promise<PaperAccountRecord | null> {
    return await this.prisma.paperAccount.findUnique({
      where: { name },
      select: { id: true, seedAmount: true, cashBalance: true },
    });
  }

  async upsertKrTicker(input: {
    code: string;
    name?: string;
    market: PaperMarket;
  }): Promise<{ id: number }> {
    // PaperMarket은 세율 계산용 시장 구분이다. Ticker identity에 섞으면 같은 토스 종목이
    // KOSPI/KOSDAQ 행과 KR 행으로 갈라지므로 토스 국내 종목은 항상 KR/TOSS로 고정한다.
    return await this.prisma.ticker.upsert({
      where: { market_code: { market: 'KR', code: input.code } },
      create: {
        code: input.code,
        market: 'KR',
        marketCountry: 'KR',
        tossSymbol: input.code,
        name: input.name ?? input.code,
        currency: 'KRW',
        source: 'TOSS',
      },
      update: {
        marketCountry: 'KR',
        tossSymbol: input.code,
        ...(input.name === undefined ? {} : { name: input.name }),
        currency: 'KRW',
        source: 'TOSS',
      },
      select: { id: true },
    });
  }

  async findPosition(
    accountId: number,
    tickerId: number,
  ): Promise<PaperPositionRecord | null> {
    return await this.prisma.paperPosition.findUnique({
      where: { accountId_tickerId: { accountId, tickerId } },
      select: {
        id: true,
        accountId: true,
        tickerId: true,
        quantity: true,
        avgPrice: true,
      },
    });
  }

  async findPositionsWithTicker(
    accountId: number,
  ): Promise<PaperPositionWithTicker[]> {
    const positions = await this.prisma.paperPosition.findMany({
      where: {
        accountId,
        quantity: { gt: 0 },
        ticker: {
          market: 'KR',
          marketCountry: 'KR',
          source: 'TOSS',
          tossSymbol: { not: null },
        },
      },
      include: { ticker: true },
      orderBy: { tickerId: 'asc' },
    });

    return positions.flatMap((position) => {
      if (!position.ticker.tossSymbol) {
        return [];
      }
      return [
        {
          id: position.id,
          accountId: position.accountId,
          tickerId: position.tickerId,
          quantity: position.quantity,
          avgPrice: position.avgPrice,
          ticker: {
            code: position.ticker.code,
            name: position.ticker.name,
            tossSymbol: position.ticker.tossSymbol,
          },
        },
      ];
    });
  }

  async applyTradeAtomically(
    input: ApplyTradeInput,
  ): Promise<ApplyTradeResult> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // 모든 거래가 같은 계좌 행을 먼저 잠근 뒤 최신 현금·포지션을 읽는다. 계좌 단위로
        // 직렬화하므로 포지션 행이 아직 없는 동시 매수도 첫 transaction이 생성한 행을
        // 다음 transaction이 읽게 되어, 둘 다 null을 보고 한쪽 수량을 잃는 경합을 막는다.
        const account = await transaction.paperAccount.update({
          where: { id: input.accountId },
          data: { cashBalance: { increment: 0 } },
          select: { id: true, seedAmount: true, cashBalance: true },
        });
        const duplicate = await transaction.paperTrade.findUnique({
          where: { fingerprint: input.fingerprint },
          select: { id: true },
        });
        if (duplicate) {
          throw new Error(
            '이미 기록된 가상 매매입니다. 중복 입력을 확인해 주세요.',
          );
        }
        const position = await transaction.paperPosition.findUnique({
          where: {
            accountId_tickerId: {
              accountId: input.accountId,
              tickerId: input.tickerId,
            },
          },
          select: {
            id: true,
            accountId: true,
            tickerId: true,
            quantity: true,
            avgPrice: true,
          },
        });
        const mutation = input.calculateMutation({ account, position });
        const trade = await transaction.paperTrade.create({
          data: {
            accountId: input.accountId,
            tickerId: input.tickerId,
            orderId: input.orderId,
            side: input.side,
            quantity: input.quantity,
            price: input.price,
            fee: mutation.fee,
            tax: mutation.tax,
            realizedPnl: mutation.realizedPnl,
            tradeDate: input.tradeDate,
            fingerprint: input.fingerprint,
          },
          select: { id: true },
        });
        await transaction.paperPosition.upsert({
          where: {
            accountId_tickerId: {
              accountId: input.accountId,
              tickerId: input.tickerId,
            },
          },
          create: {
            accountId: input.accountId,
            tickerId: input.tickerId,
            quantity: mutation.positionQuantity,
            avgPrice: mutation.positionAvgPrice,
          },
          update: {
            quantity: mutation.positionQuantity,
            avgPrice: mutation.positionAvgPrice,
          },
        });
        await transaction.paperAccount.update({
          where: { id: input.accountId },
          data: { cashBalance: mutation.cashBalance },
        });
        return { tradeId: trade.id, ...mutation };
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new Error(
          '이미 기록된 가상 매매입니다. 중복 입력을 확인해 주세요.',
        );
      }
      throw error;
    }
  }

  async findTradesForInvariant(
    accountId: number,
  ): Promise<InvariantTradeRow[]> {
    const trades = await this.prisma.paperTrade.findMany({
      where: { accountId },
      select: {
        side: true,
        quantity: true,
        price: true,
        fee: true,
        tax: true,
        tickerId: true,
      },
      orderBy: { id: 'asc' },
    });
    return trades.map((trade) => ({
      ...trade,
      side: trade.side as TradeSide,
    }));
  }

  async upsertEquitySnapshot(
    input: UpsertSnapshotInput,
  ): Promise<{ snapshotId: number }> {
    return await this.prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.paperEquitySnapshot.upsert({
        where: {
          accountId_tradeDate: {
            accountId: input.accountId,
            tradeDate: input.tradeDate,
          },
        },
        create: {
          accountId: input.accountId,
          tradeDate: input.tradeDate,
          cashBalance: input.cashBalance,
          positionValue: input.positionValue,
          totalValue: input.totalValue,
          returnRate: input.returnRate,
          staleTickerCount: input.staleTickerCount,
          benchmarkClose: input.benchmarkClose ?? null,
          isBackfilled: false,
        },
        update: {
          cashBalance: input.cashBalance,
          positionValue: input.positionValue,
          totalValue: input.totalValue,
          returnRate: input.returnRate,
          staleTickerCount: input.staleTickerCount,
          benchmarkClose: input.benchmarkClose ?? null,
          isBackfilled: false,
        },
        select: { id: true },
      });

      // 같은 날짜 재평가는 총계와 종목별 근거가 한 시점의 값이어야 한다. 기존 종목별 행을
      // 같은 transaction에서 지우고 다시 써야 중간 실패가 총계만 갱신된 상태를 남기지 않는다.
      await transaction.paperPositionSnapshot.deleteMany({
        where: { snapshotId: snapshot.id },
      });
      if (input.positions.length > 0) {
        await transaction.paperPositionSnapshot.createMany({
          data: input.positions.map((position) => ({
            snapshotId: snapshot.id,
            ...position,
          })),
        });
      }
      return { snapshotId: snapshot.id };
    });
  }

  async findRecentSnapshots(
    accountId: number,
    limit: number,
  ): Promise<SnapshotRow[]> {
    return await this.prisma.paperEquitySnapshot.findMany({
      where: { accountId },
      orderBy: { tradeDate: 'desc' },
      take: limit,
      select: {
        id: true,
        tradeDate: true,
        totalValue: true,
        returnRate: true,
      },
    });
  }

  async findLatestSnapshotBefore(
    accountId: number,
    tradeDate: Date,
  ): Promise<SnapshotRow | null> {
    return await this.prisma.paperEquitySnapshot.findFirst({
      where: { accountId, tradeDate: { lt: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: {
        id: true,
        tradeDate: true,
        totalValue: true,
        returnRate: true,
      },
    });
  }
}
