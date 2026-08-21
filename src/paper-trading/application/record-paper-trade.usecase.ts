import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  assertWholeShares,
  PaperMarket,
  parseTradeDate,
  TradeSide,
  TradeStrategy,
} from '../domain/paper-account.type';
import { applyBuy, applySell } from '../domain/position-cost';
import { calculateTradeCost } from '../domain/trade-cost';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';

export interface RecordTradeCommand {
  accountName: string;
  tickerCode: string;
  tickerName?: string;
  market: PaperMarket;
  side: TradeSide;
  quantity: string;
  price: string;
  tradeDate: string;
  strategy: TradeStrategy;
  reason?: string;
  orderId?: number;
}

export interface RecordTradeResult {
  tradeId: number;
  cashBalance: string;
  positionQuantity: string;
  positionAvgPrice: string;
  realizedPnl: string | null;
}

@Injectable()
export class RecordPaperTradeUsecase {
  constructor(private readonly repository: PaperTradingPrismaRepository) {}

  async execute(command: RecordTradeCommand): Promise<RecordTradeResult> {
    if (!/^\d{6}$/u.test(command.tickerCode)) {
      throw new Error(
        `국내 종목코드는 6자리 숫자여야 합니다. 받은 값: ${command.tickerCode}`,
      );
    }
    const quantity = new Prisma.Decimal(command.quantity);
    const price = new Prisma.Decimal(command.price);
    assertWholeShares(quantity);
    if (price.comparedTo(0) <= 0) {
      throw new Error(`체결가는 0보다 커야 합니다. 받은 값: ${command.price}`);
    }
    const tradeDate = parseTradeDate(command.tradeDate);
    const account = await this.repository.findAccountByName(
      command.accountName,
    );
    if (!account) {
      throw new Error(
        `가상 매매 계좌를 찾을 수 없습니다: ${command.accountName}`,
      );
    }
    // 한계(1단계): `command.market`(KOSPI|KOSDAQ|KONEX)은 세율 계산에만 쓰이고 어디에도
    // 저장되지 않는다. `Ticker.market` 은 토스 시세 identity 인 'KR' 이라 세부 시장을 담을
    // 자리가 없기 때문이다. 그래서 같은 종목의 매수·매도에 다른 시장을 입력해도 막지 못한다.
    //
    // 실질 영향은 지금 작다 — KOSPI 와 KOSDAQ 의 총 세율이 같아서(둘 다 0.20%) 값이 갈리는
    // 것은 KONEX(0.10%) 뿐이다. 다만 구조적으로는 종목의 속성을 거래마다 입력받는 형태이므로,
    // 2단계에서 종목 마스터에 시장 구분을 채울 때(스펙 §7 `Ticker.market` 조달) 해소한다.
    const ticker = await this.repository.upsertKrTicker({
      code: command.tickerCode,
      name: command.tickerName,
      market: command.market,
    });
    const grossAmount = quantity.times(price);
    const result = await this.repository.applyTradeAtomically({
      accountId: account.id,
      tickerId: ticker.id,
      orderId: command.orderId,
      side: command.side,
      strategy: command.strategy,
      reason: command.reason,
      quantity: quantity.toString(),
      price: price.toString(),
      tradeDate,
      calculateMutation: ({ account: freshAccount, position }) => {
        const currentPosition = {
          quantity: position?.quantity ?? new Prisma.Decimal(0),
          avgPrice: position?.avgPrice ?? new Prisma.Decimal(0),
        };
        const cost = calculateTradeCost({
          market: command.market,
          side: command.side,
          grossAmount,
          tradeDate,
        });
        const fee = new Prisma.Decimal(cost.fee);
        const tax = new Prisma.Decimal(cost.tax);
        if (command.side === 'BUY') {
          const cashRequired = grossAmount.plus(fee).plus(tax);
          if (freshAccount.cashBalance.comparedTo(cashRequired) < 0) {
            throw new Error(
              `현금 잔액이 부족합니다. 필요: ${cashRequired.toString()}원, 보유: ${freshAccount.cashBalance.toString()}원`,
            );
          }
          const outcome = applyBuy(currentPosition, { quantity, price, fee });
          return {
            fee: cost.fee,
            tax: cost.tax,
            realizedPnl: null,
            cashBalance: freshAccount.cashBalance
              .minus(cashRequired)
              .toString(),
            positionQuantity: outcome.quantity,
            positionAvgPrice: outcome.avgPrice,
          };
        }
        const outcome = applySell(currentPosition, {
          quantity,
          price,
          fee,
          tax,
        });
        return {
          fee: cost.fee,
          tax: cost.tax,
          realizedPnl: outcome.realizedPnl,
          cashBalance: freshAccount.cashBalance
            .plus(grossAmount.minus(fee).minus(tax))
            .toString(),
          positionQuantity: outcome.quantity,
          positionAvgPrice: outcome.avgPrice,
        };
      },
    });

    return {
      tradeId: result.tradeId,
      cashBalance: result.cashBalance,
      positionQuantity: result.positionQuantity,
      positionAvgPrice: result.positionAvgPrice,
      realizedPnl: result.realizedPnl,
    };
  }
}
