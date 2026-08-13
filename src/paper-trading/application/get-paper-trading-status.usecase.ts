import { Injectable } from '@nestjs/common';

import {
  PaperAccountNamedRecord,
  PaperTradingRepository,
} from '../infrastructure/paper-trading.repository';

export interface GetPaperTradingStatusCommand {
  accountName: string;
  snapshotLimit: number;
}

export interface GetAllPaperTradingStatusCommand {
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
    return await this.buildStatus(
      { ...account, name: command.accountName },
      command.snapshotLimit,
    );
  }

  // 전 계좌 현황 — 계좌 이름이 전략명(LONG_TERM / SWING)으로 열리므로 조회 쪽에서 이름을
  // 알고 있으면 전략이 늘 때 조용히 빠진다. 열려 있는 계좌를 그대로 훑는다.
  // 계좌가 없으면 빈 배열 (호출자가 "계좌 없음" 을 표현한다).
  async executeAll(
    command: GetAllPaperTradingStatusCommand,
  ): Promise<PaperTradingStatusResult[]> {
    const accounts = await this.repository.findAllAccounts();
    return await Promise.all(
      accounts.map(async (account) =>
        this.buildStatus(account, command.snapshotLimit),
      ),
    );
  }

  private async buildStatus(
    account: PaperAccountNamedRecord,
    snapshotLimit: number,
  ): Promise<PaperTradingStatusResult> {
    const [positions, snapshots] = await Promise.all([
      this.repository.findPositionsWithTicker(account.id),
      this.repository.findRecentSnapshots(account.id, snapshotLimit),
    ]);
    return {
      account: {
        name: account.name,
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
