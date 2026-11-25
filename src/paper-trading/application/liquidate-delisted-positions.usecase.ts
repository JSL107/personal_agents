import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { getKstDateOf, utcMidnightOf } from '../../common/util/kst-date.util';
import { DELISTED_LIQUIDATION_REASON_PREFIX } from '../domain/paper-account.type';
import { getKstClock } from '../domain/trade-calendar';
import {
  DelistedLiquidationTradeRecord,
  DelistedPositionRecord,
  PaperAccountNamedRecord,
  PaperTradingPrismaRepository,
} from '../infrastructure/paper-trading.prisma.repository';
import { strategyOf } from './apply-exit-band.usecase';
import { parseMarket } from './apply-intraday-stop.usecase';
import { ExecutePaperOrderUsecase } from './execute-paper-order.usecase';

export interface LiquidateDelistedCommand {
  executedAt: Date;
  agentRunId?: number | null;
}

export interface LiquidateDelistedResult {
  // 그날 원장에 체결된 폐지 청산 전부. 이번 실행이 판 것만 담으면 평가 실패 뒤 재시도 회차는
  // 보유가 이미 0 이라 빈 목록이 되어 카드에서 청산 사실이 사라진다.
  fills: DelistedLiquidationTradeRecord[];
  // 청산하지 못한 종목과 사유. 남은 보유는 장마감 평가를 계속 막으므로 카드에 드러나야 한다.
  failures: string[];
}

interface PricedDelistedPosition extends DelistedPositionRecord {
  lastClose: Prisma.Decimal;
  lastCloseDate: Date;
}

interface LiquidateAccountInput {
  account: PaperAccountNamedRecord;
  command: LiquidateDelistedCommand;
  tradeDate: string;
  tradeDay: Date;
  result: LiquidateDelistedResult;
}

const isPriced = (
  position: DelistedPositionRecord,
): position is PricedDelistedPosition =>
  position.lastClose !== null && position.lastCloseDate !== null;

// 폐지일·종가일은 UTC 자정에 박힌 날짜 컬럼이라 KST 로 옮겨도 같은 날이다.
const dateText = (value: Date): string => getKstDateOf(value);

const labelOf = (position: DelistedPositionRecord): string =>
  `${position.tickerName}(${position.tickerCode})`;

// 보유 중 상장폐지된 종목을 마지막 적재 종가로 청산한다. 이것이 없으면 폐지 종목은 시세
// 공급자에서 사라진 채 보유로 남아, 장마감 평가가 "시세를 찾을 수 없다" 며 계좌 평가를
// 통째로 건너뛰고 장중 손절은 회차마다 조회 실패를 낸다(2026-11-20 코람코더원리츠 폐지 실측).
// 청산가 규칙은 백테스트(`ReplayBacktestUsecase.liquidateDelisted`)의 기본값과 같다.
// shortcut: 회수율 1(마지막 종가 그대로) 고정. 폐지 사유별 실제 회수액(청산 배당 등)을 알게 되면 손잡이로 뺀다.
@Injectable()
export class LiquidateDelistedPositionsUsecase {
  constructor(
    private readonly repository: PaperTradingPrismaRepository,
    private readonly executeOrder: ExecutePaperOrderUsecase,
  ) {}

  async execute(
    command: LiquidateDelistedCommand,
  ): Promise<LiquidateDelistedResult> {
    const { tradeDate } = getKstClock(command.executedAt);
    const tradeDay = utcMidnightOf(tradeDate);
    const result: LiquidateDelistedResult = { fills: [], failures: [] };
    const accounts = await this.repository.findAllAccounts();
    for (const account of accounts) {
      try {
        await this.liquidateAccount({
          account,
          command,
          tradeDate,
          tradeDay,
          result,
        });
      } catch (error) {
        result.failures.push(
          `${account.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    result.fills =
      await this.repository.findDelistedLiquidationTrades(tradeDay);
    return result;
  }

  private async liquidateAccount(input: LiquidateAccountInput): Promise<void> {
    const delisted = await this.repository.findDelistedPositions({
      accountId: input.account.id,
      onOrBefore: input.tradeDay,
    });
    const priced = delisted.filter(isPriced);
    // 청산가를 지어낼 수 없다. 남겨 두면 평가가 계속 막히므로 사유로 드러낸다.
    for (const position of delisted.filter((row) => !isPriced(row))) {
      input.result.failures.push(
        `${labelOf(position)}: 적재된 종가가 없어 청산가를 정할 수 없습니다`,
      );
    }
    if (priced.length === 0) {
      return;
    }
    const tickerIds = priced.map((position) => position.tickerId);
    // 기존 대기 주문은 재사용하지 않고 지운다. 일부 수량 매도·밴드 성적 귀속·미래 목표일이 섞여
    // 보유가 남거나 엉뚱한 성적으로 잡히고, 그 대기 매도는 새 청산 주문 생성까지 막는다.
    await this.repository.expirePendingOrdersForTickers({
      accountId: input.account.id,
      tickerIds,
      statusReason: `${DELISTED_LIQUIDATION_REASON_PREFIX}으로 대체`,
    });
    await this.repository.createExitBandOrders({
      accountId: input.account.id,
      strategy: strategyOf(input.account.name),
      decidedAt: input.command.executedAt,
      dataAsOf: input.tradeDay,
      targetTradeDate: input.tradeDay,
      agentRunId: input.command.agentRunId ?? null,
      threshold: null,
      orders: priced.map((position) => ({
        tickerId: position.tickerId,
        reason: `${DELISTED_LIQUIDATION_REASON_PREFIX}: ${dateText(position.delistedAt)} 폐지 · 마지막 종가 ${position.lastClose.toString()}원(${dateText(position.lastCloseDate)})`,
      })),
    });
    const positionByTickerId = new Map(
      priced.map((position) => [position.tickerId, position]),
    );
    const dueOrders = await this.repository.findDuePendingOrders(
      input.tradeDay,
    );
    const liquidationOrders = dueOrders.filter(
      (order) =>
        order.accountId === input.account.id &&
        order.side === 'SELL' &&
        positionByTickerId.has(order.tickerId),
    );
    for (const order of liquidationOrders) {
      const position = positionByTickerId.get(order.tickerId);
      if (!position) {
        continue;
      }
      const market = parseMarket(order.krxMarket);
      if (!market) {
        await this.repository.expirePendingOrder(
          order.id,
          '종목 시장 구분 없음',
        );
        input.result.failures.push(`${labelOf(position)}: 종목 시장 구분 없음`);
        continue;
      }
      try {
        const fill = await this.executeOrder.execute({
          orderId: order.id,
          accountId: order.accountId,
          tickerId: order.tickerId,
          market,
          side: 'SELL',
          requestedQuantity: order.quantity.toString(),
          price: position.lastClose.toString(),
          tradeDate: input.tradeDate,
          strategy: order.strategy,
        });
        if (fill.status !== 'FILLED') {
          throw new Error('체결되지 않았습니다');
        }
      } catch (error) {
        // PENDING 으로 두면 체결기가 시가 없는 종목을 매 거래일 채우려다 실패한다.
        // 다음 장마감 평가가 새 주문으로 다시 시도한다.
        await this.repository.expirePendingOrder(
          order.id,
          '상장폐지 청산 실패',
        );
        input.result.failures.push(
          `${labelOf(position)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
