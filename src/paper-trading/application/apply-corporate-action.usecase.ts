import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MoneyValue } from '../../market-data/domain/market-data.type';
import { calculateDividendAmounts } from '../domain/dividend';
import {
  ApplyCorporateActionMutation,
  CorporateActionKind,
  PaperTradingPrismaRepository,
} from '../infrastructure/paper-trading.prisma.repository';

export interface ApplyCorporateActionCommand {
  accountName?: string;
  tickerCode: string;
  kind: CorporateActionKind;
  exDate: Date;
  payDate?: Date;
  perShareAmount?: string;
  quantityRatio?: string;
  eligibleQuantity?: string;
  note?: string;
  dryRun: boolean;
}

export interface CorporateActionOutcome {
  accountName: string;
  tickerCode: string;
  kind: CorporateActionKind;
  dryRun: boolean;
  eligibleQuantity: string | null;
  grossAmount: string | null;
  taxAmount: string | null;
  cashDelta: string;
  quantityDelta: string;
  avgPriceAfter: string | null;
  cashBalance: string;
  corporateActionId: number | null;
}

export interface ApplyCorporateActionResult {
  accounts: CorporateActionOutcome[];
}

interface AccountTarget {
  id: number;
  name: string;
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
}

const dateText = (value: Date): string => value.toISOString().slice(0, 10);

const parseAmount = (value: string, label: string): Prisma.Decimal => {
  const amount = new Prisma.Decimal(value);
  if (amount.comparedTo(0) <= 0) {
    throw new Error(`${label}은(는) 0보다 커야 합니다. 받은 값: ${value}`);
  }
  return amount;
};

@Injectable()
export class ApplyCorporateActionUsecase {
  constructor(private readonly repository: PaperTradingPrismaRepository) {}

  async execute(
    command: ApplyCorporateActionCommand,
  ): Promise<ApplyCorporateActionResult> {
    if (!/^\d{6}$/u.test(command.tickerCode)) {
      throw new Error(
        `국내 종목코드는 6자리 숫자여야 합니다. 받은 값: ${command.tickerCode}`,
      );
    }
    // 권리 수량을 손으로 지정하면 계좌별 자동 계산을 건너뛴다. 그 상태로 계좌를 안 고르면
    // 한 계좌의 수량이 그 종목을 들고 있지도 않은 다른 계좌에까지 그대로 입금되어, 성적표가
    // 조용히 부풀려진다. 수동 수량은 대상 계좌를 함께 지목했을 때만 받는다.
    if (
      command.eligibleQuantity !== undefined &&
      command.accountName === undefined
    ) {
      throw new Error(
        '권리 수량을 직접 지정할 때는 --account 로 대상 계좌를 함께 지정해야 합니다.',
      );
    }
    const ticker = await this.repository.findTickerByCode(command.tickerCode);
    if (!ticker) {
      throw new Error(
        `가상 매매 종목을 찾을 수 없습니다: ${command.tickerCode}`,
      );
    }
    const accounts = await this.findAccountTargets(command.accountName);
    const outcomes: CorporateActionOutcome[] = [];
    for (const account of accounts) {
      const position = await this.repository.findPosition(
        account.id,
        ticker.id,
      );
      const mutation = await this.calculateMutation({
        account,
        position,
        accountId: account.id,
        tickerId: ticker.id,
        command,
      });
      if (mutation === null) {
        continue;
      }
      if (command.dryRun) {
        outcomes.push(
          this.toOutcome({
            accountName: account.name,
            tickerCode: command.tickerCode,
            kind: command.kind,
            dryRun: true,
            mutation,
            corporateActionId: null,
          }),
        );
        continue;
      }
      const result = await this.repository.applyCorporateActionAtomically({
        accountId: account.id,
        tickerId: ticker.id,
        kind: command.kind,
        exDate: command.exDate,
        payDate: command.payDate,
        perShareAmount: command.perShareAmount,
        quantityRatio: command.quantityRatio,
        note: command.note,
        decide: ({ account: freshAccount, position: freshPosition }) => {
          const freshMutation = this.calculateMutationFromState({
            account: freshAccount,
            position: freshPosition,
            command,
            eligibleQuantity: mutation.eligibleQuantity,
          });
          if (freshMutation === null) {
            throw new Error('기업행동을 적용할 보유 수량이 없습니다.');
          }
          return freshMutation;
        },
      });
      outcomes.push(
        this.toOutcome({
          accountName: account.name,
          tickerCode: command.tickerCode,
          kind: command.kind,
          dryRun: false,
          mutation: result,
          corporateActionId: result.corporateActionId,
        }),
      );
    }
    return { accounts: outcomes };
  }

  private async findAccountTargets(
    accountName: string | undefined,
  ): Promise<AccountTarget[]> {
    if (accountName !== undefined) {
      const account = await this.repository.findAccountByName(accountName);
      if (!account) {
        throw new Error(`가상 매매 계좌를 찾을 수 없습니다: ${accountName}`);
      }
      return [{ ...account, name: accountName }];
    }
    return await this.repository.findAllAccounts();
  }

  private async calculateMutation(input: {
    account: AccountTarget;
    position: {
      quantity: MoneyValue;
      avgPrice: MoneyValue;
    } | null;
    accountId: number;
    tickerId: number;
    command: ApplyCorporateActionCommand;
  }): Promise<ApplyCorporateActionMutation | null> {
    const eligibleQuantity =
      input.command.kind === 'DIVIDEND'
        ? input.command.eligibleQuantity !== undefined
          ? parseAmount(input.command.eligibleQuantity, '권리 수량')
          : await this.repository.findQuantityAtDate(
              input.accountId,
              input.tickerId,
              input.command.exDate,
            )
        : (input.position?.quantity ?? null);
    if (eligibleQuantity === null) {
      return null;
    }
    if (
      input.command.kind === 'DIVIDEND' &&
      input.command.eligibleQuantity === undefined &&
      eligibleQuantity.comparedTo(0) <= 0
    ) {
      return null;
    }
    // 수량을 바꾸는 종류는 지금 보유한 주식을 쪼개거나 합친다. 그런데 권리락일 뒤에 매매가
    // 있었다면 현재 수량에는 권리와 무관한 주식이 섞여 있어, 그대로 조정하면 나중에 산
    // 주식까지 쪼개고 그 사이 판 주식은 빠뜨린다. 배당은 현금만 더해 되돌리기 쉽지만 이쪽은
    // 수량·평단을 덮어쓰므로 복구가 어렵다 — 어긋난 채 적용하느니 소급 입력을 거부한다.
    if (input.command.kind !== 'DIVIDEND' && input.position !== null) {
      const quantityAtExDate = await this.repository.findQuantityAtDate(
        input.accountId,
        input.tickerId,
        input.command.exDate,
      );
      if (quantityAtExDate.comparedTo(input.position.quantity) !== 0) {
        throw new Error(
          `권리락일(${dateText(input.command.exDate)}) 이후 이 종목에 매매가 있어 소급 적용할 수 없습니다. ` +
            `권리일 수량 ${quantityAtExDate.toString()}주, 현재 ${input.position.quantity.toString()}주.`,
        );
      }
    }
    return this.calculateMutationFromState({
      account: input.account,
      position: input.position,
      command: input.command,
      eligibleQuantity: eligibleQuantity.toString(),
    });
  }

  private calculateMutationFromState(input: {
    account: { cashBalance: MoneyValue };
    position: { quantity: MoneyValue; avgPrice: MoneyValue } | null;
    command: ApplyCorporateActionCommand;
    eligibleQuantity: string | null;
  }): ApplyCorporateActionMutation | null {
    if (input.command.kind === 'DIVIDEND') {
      if (input.command.perShareAmount === undefined) {
        throw new Error('DIVIDEND에는 --per-share가 필요합니다.');
      }
      const perShareAmount = parseAmount(
        input.command.perShareAmount,
        '주당 배당금',
      );
      if (input.eligibleQuantity === null) {
        return null;
      }
      const eligibleQuantity = parseAmount(input.eligibleQuantity, '권리 수량');
      const amounts = calculateDividendAmounts({
        perShareAmount,
        eligibleQuantity,
      });
      // 배당은 현금만 움직이는 실제 증권사 회계와 같아야 한다. 배당금을 평단에 나누어
      // 반영하면 이후 매도 손익과 기업행동 원장이 서로 다른 손익을 만들게 된다.
      return {
        cashBalance: input.account.cashBalance.plus(amounts.net).toString(),
        cashDelta: amounts.net.toString(),
        quantityDelta: '0',
        avgPriceAfter: null,
        eligibleQuantity: eligibleQuantity.toString(),
        grossAmount: amounts.gross.toString(),
        taxAmount: amounts.tax.toString(),
      };
    }

    if (!input.position) {
      return null;
    }
    if (input.command.quantityRatio === undefined) {
      throw new Error(
        `${input.command.kind}에는 --quantity-ratio가 필요합니다.`,
      );
    }
    const quantityRatio = parseAmount(input.command.quantityRatio, '수량 배율');
    if (
      (input.command.kind === 'MERGE' && quantityRatio.comparedTo(1) >= 0) ||
      (input.command.kind !== 'MERGE' && quantityRatio.comparedTo(1) <= 0)
    ) {
      throw new Error(
        `${input.command.kind}의 수량 배율이 올바르지 않습니다: ${quantityRatio.toString()}`,
      );
    }
    const quantityDelta = input.position.quantity
      .times(quantityRatio.minus(1))
      .toString();
    // 분할·병합·무상증자만 보유 수량과 평단을 함께 조정한다. 현금은 움직이지 않는다.
    return {
      cashBalance: input.account.cashBalance.toString(),
      cashDelta: '0',
      quantityDelta,
      avgPriceAfter: input.position.avgPrice
        .dividedBy(quantityRatio)
        .toString(),
      eligibleQuantity: input.position.quantity.toString(),
      grossAmount: null,
      taxAmount: null,
    };
  }

  private toOutcome(input: {
    accountName: string;
    tickerCode: string;
    kind: CorporateActionKind;
    dryRun: boolean;
    mutation: ApplyCorporateActionMutation;
    corporateActionId: number | null;
  }): CorporateActionOutcome {
    return {
      accountName: input.accountName,
      tickerCode: input.tickerCode,
      kind: input.kind,
      dryRun: input.dryRun,
      eligibleQuantity: input.mutation.eligibleQuantity,
      grossAmount: input.mutation.grossAmount,
      taxAmount: input.mutation.taxAmount,
      cashDelta: input.mutation.cashDelta,
      quantityDelta: input.mutation.quantityDelta,
      avgPriceAfter: input.mutation.avgPriceAfter,
      cashBalance: input.mutation.cashBalance,
      corporateActionId: input.corporateActionId,
    };
  }
}
