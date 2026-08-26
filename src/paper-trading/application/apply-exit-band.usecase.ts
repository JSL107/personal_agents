import { Injectable } from '@nestjs/common';

import { ResolveStrategyParametersUsecase } from '../../strategy-parameter/application/resolve-strategy-parameters.usecase';
import {
  decideExitBandOrders,
  DEFAULT_EXIT_BAND,
  describeExitBandReason,
  ExitBandThreshold,
} from '../domain/exit-band';
import { TradeStrategy } from '../domain/paper-account.type';
import { nextWeekday } from '../domain/trade-calendar';
import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { EvaluatedAccountEntry } from './evaluate-paper-account.usecase';

export interface ApplyExitBandCommand {
  accounts: EvaluatedAccountEntry[];
  executedAt: Date;
  agentRunId?: number | null;
  // 지정하면 모든 계좌에 이 밴드를 건다. 지정하지 않으면 계좌의 전략에 해당하는 값을
  // `strategy_parameter` 에서 해소하고, 없으면 코드 상수를 쓴다.
  threshold?: ExitBandThreshold;
}

export interface ExitBandAccountOutcome {
  accountName: string;
  created: number;
  skippedByPendingSell: number;
  skippedByNoPosition: number;
  reasons: string[];
}

export interface ApplyExitBandResult {
  accounts: ExitBandAccountOutcome[];
  createdCount: number;
}

// 계좌 이름이 곧 전략명이다 (PAPER_RECOMMEND 가 LONG_TERM / SWING 으로 연다).
// 규칙에서 나온 주문도 그 전략의 성적으로 집계돼야 채점이 한 계좌를 두 갈래로
// 쪼개 보지 않는다. 수동 계좌(DEFAULT)는 전략이 없으므로 MANUAL 로 남긴다.
export const strategyOf = (accountName: string): TradeStrategy => {
  if (accountName === 'LONG_TERM' || accountName === 'SWING') {
    return accountName;
  }
  return 'MANUAL';
};

@Injectable()
export class ApplyExitBandUsecase {
  constructor(
    private readonly repository: PaperTradingPrismaRepository,
    private readonly strategyParameters: ResolveStrategyParametersUsecase,
  ) {}

  async execute(command: ApplyExitBandCommand): Promise<ApplyExitBandResult> {
    // 밴드는 계좌마다 다를 수 있다 — 계좌 이름이 곧 전략이고 파라미터는 전략별이다.
    // 전략당 한 번만 해소해 같은 회차가 같은 값을 쓰게 한다.
    const thresholdByStrategy = new Map<TradeStrategy, ExitBandThreshold>();
    const resolveThreshold = async (
      accountName: string,
    ): Promise<ExitBandThreshold> => {
      if (command.threshold !== undefined) {
        return command.threshold;
      }
      const strategy = strategyOf(accountName);
      // 수동 계좌는 전략 파라미터의 대상이 아니다. 규칙이 연 계좌가 아니므로
      // 규칙을 바꿔도 이 계좌의 청산 기준은 따라 움직이지 않는다.
      if (strategy === 'MANUAL') {
        return DEFAULT_EXIT_BAND;
      }
      const cached = thresholdByStrategy.get(strategy);
      if (cached !== undefined) {
        return cached;
      }
      const parameters = await this.strategyParameters.execute(strategy);
      thresholdByStrategy.set(strategy, parameters.exitBand);
      return parameters.exitBand;
    };
    const accounts: ExitBandAccountOutcome[] = [];

    for (const entry of command.accounts) {
      // 스냅샷이 막힌 회차(불변식 위반·시세 결측)의 평가값은 신뢰할 수 없다.
      // 그 값으로 매도를 걸면 잘못된 근거로 판 뒤 되돌릴 수 없다.
      if (!entry.evaluation || entry.evaluation.skipped) {
        continue;
      }
      const threshold = await resolveThreshold(entry.accountName);
      const decisions = decideExitBandOrders(
        entry.evaluation.positions.map((position) => ({
          tickerId: position.tickerId,
          tickerCode: position.tickerCode,
          quantity: position.quantity,
          returnRate: position.returnRate,
          isStale: position.isStale,
        })),
        threshold,
      );
      if (decisions.length === 0) {
        continue;
      }
      const account = await this.repository.findAccountByName(
        entry.accountName,
      );
      if (!account) {
        continue;
      }
      const tradeDate = entry.evaluation.tradeDate;
      const outcome = await this.repository.createExitBandOrders({
        accountId: account.id,
        strategy: strategyOf(entry.accountName),
        decidedAt: command.executedAt,
        dataAsOf:
          tradeDate === null
            ? command.executedAt
            : new Date(`${tradeDate}T00:00:00.000Z`),
        targetTradeDate: nextWeekday(command.executedAt),
        agentRunId: command.agentRunId ?? null,
        threshold,
        orders: decisions.map((decision) => ({
          tickerId: decision.tickerId,
          reason: describeExitBandReason(decision, threshold),
        })),
      });
      // 저장된 종목만 남긴다. 판정 목록을 그대로 실으면 중복·보유 소멸로 걸러진 것까지
      // "예약됨" 으로 적혀 카드의 건수와 상세가 어긋난다.
      const createdTickerIds = new Set(outcome.createdTickerIds);
      accounts.push({
        accountName: entry.accountName,
        created: outcome.created,
        skippedByPendingSell: outcome.skippedByPendingSell,
        skippedByNoPosition: outcome.skippedByNoPosition,
        reasons: decisions
          .filter((decision) => createdTickerIds.has(decision.tickerId))
          .map(
            (decision) =>
              `${decision.tickerCode} ${describeExitBandReason(decision, threshold)}`,
          ),
      });
    }

    return {
      accounts,
      createdCount: accounts.reduce(
        (total, account) => total + account.created,
        0,
      ),
    };
  }
}
