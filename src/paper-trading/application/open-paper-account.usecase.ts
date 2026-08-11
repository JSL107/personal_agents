import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaperTradingRepository } from '../infrastructure/paper-trading.repository';

export interface OpenAccountCommand {
  accountName: string;
  seedAmount: string;
  openedAt: Date;
  currency?: string;
}

export interface OpenAccountResult {
  accountId: number;
  seedAmount: string;
  cashBalance: string;
}

@Injectable()
export class OpenPaperAccountUsecase {
  constructor(private readonly repository: PaperTradingRepository) {}

  async execute(command: OpenAccountCommand): Promise<OpenAccountResult> {
    const seedAmount = new Prisma.Decimal(command.seedAmount);
    if (!seedAmount.isFinite() || seedAmount.comparedTo(0) <= 0) {
      throw new Error(
        `가상 매매 시드는 0보다 커야 합니다. 받은 값: ${command.seedAmount}`,
      );
    }
    const existingAccount = await this.repository.findAccountByName(
      command.accountName,
    );
    if (existingAccount) {
      throw new Error(
        `같은 이름의 가상 매매 계좌가 이미 있습니다: ${command.accountName}`,
      );
    }
    const account = await this.repository.createAccount({
      name: command.accountName,
      currency: command.currency ?? 'KRW',
      seedAmount,
      openedAt: command.openedAt,
    });
    const normalizedSeedAmount = seedAmount.toString();
    return {
      accountId: account.id,
      seedAmount: normalizedSeedAmount,
      cashBalance: normalizedSeedAmount,
    };
  }
}
