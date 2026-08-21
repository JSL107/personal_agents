import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MoneyValue } from '../../market-data/domain/market-data.type';
import {
  assertWholeShares,
  PaperMarket,
  parseTradeDate,
  TradeSide,
  TradeStrategy,
} from '../domain/paper-account.type';
import {
  PAPER_ORDER_LEDGER_PORT,
  PaperOrderLedgerPort,
  PendingOrderFillResult,
} from '../domain/port/paper-order-ledger.port';
import { applyBuy, applySell } from '../domain/position-cost';
import { calculateTradeCost } from '../domain/trade-cost';

export interface ExecutePaperOrderCommand {
  orderId: number;
  accountId: number;
  tickerId: number;
  market: PaperMarket;
  side: TradeSide;
  requestedQuantity: string;
  price: string;
  tradeDate: string;
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
}

// 대기 주문 하나를 체결로 바꾸는 규칙 — 현금이 모자라면 살 수 있는 수량까지 줄이고, 보유보다
// 많이 팔려 하면 보유까지 깎고, 한 주도 못 되면 만료로 끊는다. 수수료·세금·평단은 도메인 함수가
// 계산한다.
//
// 이 클래스가 규칙의 유일한 사본이다. 원장(어디에 적을지)만 PaperOrderLedgerPort 로 갈아끼우므로
// 백테스트와 모의투자가 같은 판정을 통과한다 — 백테스트 성적이 좋았던 이유가 "체결을 후하게
// 쳐 줘서" 는 아니게 만드는 것이 목적이다.
@Injectable()
export class ExecutePaperOrderUsecase {
  constructor(
    @Inject(PAPER_ORDER_LEDGER_PORT)
    private readonly ledger: PaperOrderLedgerPort,
  ) {}

  async execute(
    command: ExecutePaperOrderCommand,
  ): Promise<PendingOrderFillResult> {
    const requestedQuantity = new Prisma.Decimal(command.requestedQuantity);
    const price = new Prisma.Decimal(command.price);
    assertWholeShares(requestedQuantity);
    if (price.comparedTo(0) <= 0) {
      throw new Error(`체결가는 0보다 커야 합니다. 받은 값: ${command.price}`);
    }
    const tradeDate = parseTradeDate(command.tradeDate);
    return await this.ledger.fillPendingOrderAtomically({
      orderId: command.orderId,
      accountId: command.accountId,
      tickerId: command.tickerId,
      side: command.side,
      strategy: command.strategy,
      price: price.toString(),
      tradeDate,
      decide: ({ account, position }) => {
        let quantity = requestedQuantity;
        if (command.side === 'BUY') {
          quantity = this.findAffordableBuyQuantity({
            requestedQuantity,
            price,
            cashBalance: account.cashBalance,
            market: command.market,
            tradeDate,
          });
          if (quantity.comparedTo(0) === 0) {
            return { status: 'EXPIRED', statusReason: '현금 부족' };
          }
        } else {
          const heldQuantity = position?.quantity ?? new Prisma.Decimal(0);
          if (quantity.comparedTo(heldQuantity.toString()) > 0) {
            quantity = new Prisma.Decimal(heldQuantity.toString());
          }
          if (quantity.comparedTo(0) === 0) {
            return { status: 'EXPIRED', statusReason: '보유 수량 없음' };
          }
        }
        const grossAmount = quantity.times(price);
        const cost = calculateTradeCost({
          market: command.market,
          side: command.side,
          grossAmount,
          tradeDate,
        });
        const fee = new Prisma.Decimal(cost.fee);
        const tax = new Prisma.Decimal(cost.tax);
        const currentPosition = {
          quantity: position?.quantity ?? new Prisma.Decimal(0),
          avgPrice: position?.avgPrice ?? new Prisma.Decimal(0),
        };
        if (command.side === 'BUY') {
          const outcome = applyBuy(currentPosition, { quantity, price, fee });
          return {
            status: 'FILLED',
            quantity: quantity.toString(),
            fee: cost.fee,
            tax: cost.tax,
            realizedPnl: null,
            cashBalance: account.cashBalance
              .minus(grossAmount.plus(fee).plus(tax))
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
          status: 'FILLED',
          quantity: quantity.toString(),
          fee: cost.fee,
          tax: cost.tax,
          realizedPnl: outcome.realizedPnl,
          cashBalance: account.cashBalance
            .plus(grossAmount.minus(fee).minus(tax))
            .toString(),
          positionQuantity: outcome.quantity,
          positionAvgPrice: outcome.avgPrice,
        };
      },
    });
  }

  private findAffordableBuyQuantity(input: {
    requestedQuantity: Prisma.Decimal;
    price: Prisma.Decimal;
    cashBalance: MoneyValue;
    market: PaperMarket;
    tradeDate: Date;
  }): Prisma.Decimal {
    let low = 0;
    let high = input.requestedQuantity.toNumber();
    while (low < high) {
      const candidate = Math.ceil((low + high) / 2);
      const quantity = new Prisma.Decimal(candidate);
      const grossAmount = quantity.times(input.price);
      const cost = calculateTradeCost({
        market: input.market,
        side: 'BUY',
        grossAmount,
        tradeDate: input.tradeDate,
      });
      const required = grossAmount
        .plus(new Prisma.Decimal(cost.fee))
        .plus(new Prisma.Decimal(cost.tax));
      if (input.cashBalance.comparedTo(required) >= 0) {
        low = candidate;
      } else {
        high = candidate - 1;
      }
    }
    return new Prisma.Decimal(low);
  }
}
