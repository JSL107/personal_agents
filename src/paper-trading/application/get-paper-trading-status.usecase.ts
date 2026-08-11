import { Injectable } from '@nestjs/common';

import { PaperTradingRepository } from '../infrastructure/paper-trading.repository';

export interface GetPaperTradingStatusCommand {
  accountName: string;
  snapshotLimit: number;
}

export interface PaperTradingStatusResult {
  account: {
    name: string;
    seedAmount: string;
    cashBalance: string;
  };
  positions: Array<{
    tickerCode: string;
    tickerName: string;
    quantity: string;
    avgPrice: string;
  }>;
  snapshots: Array<{
    tradeDate: string;
    totalValue: string;
    returnRate: string;
  }>;
}

@Injectable()
export class GetPaperTradingStatusUsecase {
  constructor(private readonly repository: PaperTradingRepository) {}

  async execute(
    command: GetPaperTradingStatusCommand,
  ): Promise<PaperTradingStatusResult> {
    const account = await this.repository.findAccountByName(
      command.accountName,
    );
    if (!account) {
      throw new Error(
        `가상 매매 계좌를 찾을 수 없습니다: ${command.accountName}`,
      );
    }
    const [positions, snapshots] = await Promise.all([
      this.repository.findPositionsWithTicker(account.id),
      this.repository.findRecentSnapshots(account.id, command.snapshotLimit),
    ]);
    return {
      account: {
        name: command.accountName,
        seedAmount: account.seedAmount.toString(),
        cashBalance: account.cashBalance.toString(),
      },
      positions: positions.map((position) => ({
        tickerCode: position.ticker.code,
        tickerName: position.ticker.name,
        quantity: position.quantity.toString(),
        avgPrice: position.avgPrice.toString(),
      })),
      snapshots: snapshots.map((snapshot) => ({
        tradeDate: snapshot.tradeDate.toISOString().slice(0, 10),
        totalValue: snapshot.totalValue.toString(),
        returnRate: snapshot.returnRate.toString(),
      })),
    };
  }
}
