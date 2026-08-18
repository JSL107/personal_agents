import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { StockIndicators } from '../../../market-data/domain/stock-indicator';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { OpenPaperAccountUsecase } from '../../../paper-trading/application/open-paper-account.usecase';
import { nextWeekday } from '../../../paper-trading/domain/trade-calendar';
import {
  LockedPaperRecommendationState,
  PaperAccountRecord,
  PaperTradingPrismaRepository,
  PendingPaperOrderInput,
} from '../../../paper-trading/infrastructure/paper-trading.prisma.repository';
import {
  ScreenUniverseResult,
  ScreenUniverseUsecase,
} from '../../../screener/application/screen-universe.usecase';
import { constrainPaperRecommendation } from '../domain/paper-recommendation.constraint';
import { parsePaperRecommendation } from '../domain/paper-recommendation.parser';
import {
  ConstrainedPaperRecommendation,
  PaperRecommendationSkip,
  PaperRecommendationSkipReason,
  PaperRecommendationStrategy,
} from '../domain/paper-recommendation.type';
import {
  buildPaperRecommendationPrompt,
  PAPER_RECOMMEND_SYSTEM_PROMPT,
} from '../domain/prompt/paper-recommend-system.prompt';

const PAPER_ACCOUNT_SEED_AMOUNT = '10000000';
const DEFAULT_STRATEGIES: PaperRecommendationStrategy[] = [
  'LONG_TERM',
  'SWING',
];

export interface GeneratePaperRecommendationCommand {
  strategies?: PaperRecommendationStrategy[];
  decidedAt?: Date;
  triggerType?: TriggerType;
}

export interface PaperRecommendationSuccess {
  strategy: PaperRecommendationStrategy;
  accountId: number;
  ordersCreated: number;
  agentRunId: number;
  orders: PaperRecommendationOrderDetail[];
  skipped: PaperRecommendationSkipDetail[];
  account: PaperRecommendationAccountSummary;
  // 스크리너 기준일. null 이면 시세가 없어 주문 자체가 생성되지 않은 회차다.
  dataAsOf: string | null;
}

export interface PaperRecommendationOrderDetail {
  side: 'BUY' | 'SELL';
  code: string;
  name: string;
  quantity: number;
  // 전일 종가 × 수량. 보유 종목 시세가 stale 해 종가를 못 구하면 null (0 원으로 오인되지 않게).
  estimatedAmount: number | null;
  reason: string;
}

export interface PaperRecommendationSkipDetail {
  side: 'BUY' | 'SELL';
  code: string;
  name: string;
  reason: PaperRecommendationSkipReason;
}

export interface PaperRecommendationAccountSummary {
  cashBalance: number;
  totalValue: number;
  positionCount: number;
  // 시드 대비 수익률(%). 평가 스냅샷이 아직 없으면 null.
  returnRate: number | null;
}

export interface PaperRecommendationFailure {
  strategy: PaperRecommendationStrategy;
  message: string;
}

export interface GeneratePaperRecommendationResult {
  completed: PaperRecommendationSuccess[];
  failed: PaperRecommendationFailure[];
}

interface LockedRecommendationResult {
  constrained: ConstrainedPaperRecommendation;
  orders: PendingPaperOrderInput[];
}

@Injectable()
export class GeneratePaperRecommendationUsecase {
  constructor(
    private readonly screenUniverseUsecase: ScreenUniverseUsecase,
    private readonly openPaperAccountUsecase: OpenPaperAccountUsecase,
    private readonly repository: PaperTradingPrismaRepository,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute(
    command: GeneratePaperRecommendationCommand = {},
  ): Promise<GeneratePaperRecommendationResult> {
    const decidedAt = command.decidedAt ?? new Date();
    const strategies = command.strategies ?? DEFAULT_STRATEGIES;
    const completed: PaperRecommendationSuccess[] = [];
    const failed: PaperRecommendationFailure[] = [];

    for (const strategy of strategies) {
      try {
        const outcome = await this.generateForStrategy({
          strategy,
          decidedAt,
          triggerType:
            command.triggerType ?? TriggerType.AUTOPILOT_PAPER_RECOMMEND_CRON,
        });
        completed.push(outcome);
      } catch (error: unknown) {
        failed.push({ strategy, message: errorMessageOf(error) });
      }
    }
    return { completed, failed };
  }

  private async generateForStrategy({
    strategy,
    decidedAt,
    triggerType,
  }: {
    strategy: PaperRecommendationStrategy;
    decidedAt: Date;
    triggerType: TriggerType;
  }): Promise<PaperRecommendationSuccess> {
    const outcome = await this.agentRunService.execute({
      agentType: AgentType.PAPER_RECOMMEND,
      triggerType,
      inputSnapshot: {
        strategy,
        decidedAt: decidedAt.toISOString(),
        systemPrompt: PAPER_RECOMMEND_SYSTEM_PROMPT,
        prompt: null,
        ruleVersion: null,
      },
      run: async ({ agentRunId, updateInputSnapshot }) => {
        const account = await this.findOrOpenAccount(strategy, decidedAt);
        const positions = await this.repository.findPositionsWithTicker(
          account.id,
        );
        const screen = await this.screenUniverseUsecase.execute({
          strategy,
          limit: 20,
          includeTickerIds: positions.map((position) => position.tickerId),
        });
        const valuation = await this.repository.findLatestValuation(account.id);
        const accountValuation = Number(
          (valuation?.totalValue ?? account.seedAmount).toString(),
        );
        const indicatorSources = [
          ...screen.includedIndicators,
          ...screen.stocks,
        ];
        const indicatorsByCode = new Map(
          indicatorSources.map((stock) => [stock.code, stock.indicators]),
        );
        const indicatorsByTickerId = new Map(
          indicatorSources.map((stock) => [stock.tickerId, stock.indicators]),
        );
        const prompt = buildPaperRecommendationPrompt({
          strategy,
          cashBalance: Number(account.cashBalance.toString()),
          accountValuation,
          positions: positions.map((position) => ({
            code: position.ticker.code,
            name: position.ticker.name,
            quantity: Number(position.quantity.toString()),
            indicators: indicatorsByCode.get(position.ticker.code) ?? null,
          })),
          candidates: screen.stocks.map((stock) => ({
            code: stock.code,
            name: stock.name,
            score: stock.score,
            indicators: stock.indicators,
          })),
        });
        await updateInputSnapshot({
          strategy,
          decidedAt: decidedAt.toISOString(),
          systemPrompt: PAPER_RECOMMEND_SYSTEM_PROMPT,
          prompt,
          ruleVersion: screen.ruleVersion,
        });
        const completion = await this.modelRouter.route({
          agentType: AgentType.PAPER_RECOMMEND,
          request: {
            prompt,
            systemPrompt: PAPER_RECOMMEND_SYSTEM_PROMPT,
          },
        });
        const recommendation = parsePaperRecommendation(completion.text);
        const result = await this.repository.saveRecommendationAtomically({
          accountId: account.id,
          strategy,
          decidedAt,
          decide: (state) => {
            const lockedRecommendation = this.constrainLockedRecommendation({
              strategy,
              decidedAt,
              screen,
              indicatorsByTickerId,
              agentRunId,
              recommendation,
              state,
            });
            const orders = lockedRecommendation.orders;
            return {
              result: {
                strategy,
                accountId: account.id,
                ordersCreated: orders.length,
                agentRunId,
                orders: this.toOrderDetails({
                  screen,
                  state,
                  lockedRecommendation,
                }),
                skipped: this.toSkipDetails({
                  screen,
                  state,
                  constrained: lockedRecommendation.constrained,
                }),
                dataAsOf: screen.asOf,
                account: {
                  cashBalance: Number(state.account.cashBalance.toString()),
                  totalValue: Number(
                    (
                      state.latestValuation?.totalValue ??
                      state.account.seedAmount
                    ).toString(),
                  ),
                  positionCount: state.positions.length,
                  returnRate:
                    state.latestValuation === null
                      ? null
                      : Number(state.latestValuation.returnRate.toString()),
                },
              },
              orders,
            };
          },
        });
        return {
          result,
          modelUsed: completion.modelUsed,
          output: result,
        };
      },
    });
    return outcome.result;
  }

  private async findOrOpenAccount(
    strategy: PaperRecommendationStrategy,
    decidedAt: Date,
  ): Promise<PaperAccountRecord> {
    const existing = await this.repository.findAccountByName(strategy);
    if (existing) {
      return existing;
    }
    try {
      await this.openPaperAccountUsecase.execute({
        accountName: strategy,
        seedAmount: PAPER_ACCOUNT_SEED_AMOUNT,
        openedAt: decidedAt,
      });
    } catch (error: unknown) {
      const racedAccount = await this.repository.findAccountByName(strategy);
      if (racedAccount) {
        return racedAccount;
      }
      throw error;
    }
    const created = await this.repository.findAccountByName(strategy);
    if (!created) {
      throw new Error(`생성한 가상 매매 계좌를 찾을 수 없습니다: ${strategy}`);
    }
    return created;
  }

  private constrainLockedRecommendation({
    strategy,
    decidedAt,
    screen,
    indicatorsByTickerId,
    agentRunId,
    recommendation,
    state,
  }: {
    strategy: PaperRecommendationStrategy;
    decidedAt: Date;
    screen: ScreenUniverseResult;
    indicatorsByTickerId: Map<number, StockIndicators>;
    agentRunId: number;
    recommendation: ReturnType<typeof parsePaperRecommendation>;
    state: LockedPaperRecommendationState;
  }): LockedRecommendationResult {
    const stocksByTickerId = new Map(
      screen.stocks.map((stock) => [stock.tickerId, stock]),
    );
    const pendingBuyTickerIds = new Set(
      state.existingOrders
        .filter((order) => order.side === 'BUY')
        .map((order) => order.tickerId),
    );
    const pendingSellTickerIds = new Set(
      state.existingOrders
        .filter((order) => order.side === 'SELL')
        .map((order) => order.tickerId),
    );
    const reservedCash = state.existingOrders.reduce((sum, order) => {
      if (order.side !== 'BUY') {
        return sum;
      }
      const snapshot = order.indicatorSnapshot as { close?: unknown } | null;
      const close =
        typeof snapshot?.close === 'number' && Number.isFinite(snapshot.close)
          ? snapshot.close
          : 0;
      return sum + Number(order.quantity.toString()) * close;
    }, 0);
    const pendingBuyPositions = [...pendingBuyTickerIds].flatMap((tickerId) => {
      const stock = stocksByTickerId.get(tickerId);
      return stock ? [{ tickerId, code: stock.code, quantity: 1 }] : [];
    });
    // 이미 대기 중인 매도 주문 때문에 제약 함수까지 가지 못한 추천은 skipped 에 남지 않는다 —
    // 그대로 두면 Slack 이 '추천 없음' 으로 단정하므로 여기서 직접 기록한다.
    const pendingSells: PaperRecommendationSkip[] = [];
    const constrained = constrainPaperRecommendation({
      recommendation: {
        ...recommendation,
        sells: recommendation.sells.filter((sell) => {
          const position = state.positions.find(
            (item) => item.ticker.code === sell.code,
          );
          if (position) {
            if (pendingSellTickerIds.has(position.tickerId)) {
              pendingSells.push({
                side: 'SELL',
                code: sell.code,
                reason: 'PENDING_ORDER_EXISTS',
              });
              return false;
            }
            return true;
          }
          const candidate = screen.stocks.find(
            (stock) => stock.code === sell.code,
          );
          if (candidate && pendingSellTickerIds.has(candidate.tickerId)) {
            pendingSells.push({
              side: 'SELL',
              code: sell.code,
              reason: 'PENDING_ORDER_EXISTS',
            });
            return false;
          }
          return true;
        }),
      },
      candidates: screen.stocks.map((stock) => ({
        tickerId: stock.tickerId,
        code: stock.code,
        name: stock.name,
        close: stock.indicators.close,
      })),
      positions: [
        ...state.positions.map((position) => ({
          tickerId: position.tickerId,
          code: position.ticker.code,
          quantity: Number(position.quantity.toString()),
        })),
        ...pendingBuyPositions,
      ],
      cashBalance: Math.max(
        0,
        Number(state.account.cashBalance.toString()) - reservedCash,
      ),
      accountValuation: Number(
        (
          state.latestValuation?.totalValue ?? state.account.seedAmount
        ).toString(),
      ),
    });
    const orders = this.toPendingOrders({
      strategy,
      decidedAt,
      screen,
      indicatorsByTickerId,
      agentRunId,
      constrained,
    });
    return {
      constrained: {
        ...constrained,
        skipped: [...pendingSells, ...constrained.skipped],
      },
      orders,
    };
  }

  private toOrderDetails({
    screen,
    state,
    lockedRecommendation,
  }: {
    screen: ScreenUniverseResult;
    state: LockedPaperRecommendationState;
    lockedRecommendation: LockedRecommendationResult;
  }): PaperRecommendationOrderDetail[] {
    if (lockedRecommendation.orders.length === 0) {
      return [];
    }
    const namesByCode = this.namesByCode(screen, state);
    // 보유 종목 종가는 screen.stocks 가 아니라 includedIndicators 에 실려 온다.
    // stocks 만 보면 매도 예상금액이 늘 0 이 된다.
    const closesByCode = new Map(
      [...screen.includedIndicators, ...screen.stocks].map(
        (stock): [string, number] => [stock.code, stock.indicators.close],
      ),
    );
    return [
      ...lockedRecommendation.constrained.sells.map((sell) => ({
        side: sell.side,
        code: sell.code,
        name: namesByCode.get(sell.code) ?? sell.code,
        quantity: sell.quantity,
        estimatedAmount: estimatedAmountOf(
          sell.quantity,
          closesByCode.get(sell.code),
        ),
        reason: sell.reason,
      })),
      ...lockedRecommendation.constrained.buys.map((buy) => ({
        side: buy.side,
        code: buy.code,
        name: buy.name,
        quantity: buy.quantity,
        estimatedAmount: buy.quantity * buy.close,
        reason: buy.reason,
      })),
    ];
  }

  private toSkipDetails({
    screen,
    state,
    constrained,
  }: {
    screen: ScreenUniverseResult;
    state: LockedPaperRecommendationState;
    constrained: ConstrainedPaperRecommendation;
  }): PaperRecommendationSkipDetail[] {
    const namesByCode = this.namesByCode(screen, state);
    return constrained.skipped.map((skip) => ({
      ...skip,
      name: namesByCode.get(skip.code) ?? skip.code,
    }));
  }

  private namesByCode(
    screen: ScreenUniverseResult,
    state: LockedPaperRecommendationState,
  ): Map<string, string> {
    return new Map([
      ...screen.stocks.map((stock): [string, string] => [
        stock.code,
        stock.name,
      ]),
      ...state.positions.map((position): [string, string] => [
        position.ticker.code,
        position.ticker.name,
      ]),
    ]);
  }

  private toPendingOrders({
    strategy,
    decidedAt,
    screen,
    indicatorsByTickerId,
    agentRunId,
    constrained,
  }: {
    strategy: PaperRecommendationStrategy;
    decidedAt: Date;
    screen: ScreenUniverseResult;
    indicatorsByTickerId: Map<number, StockIndicators>;
    agentRunId: number;
    constrained: ReturnType<typeof constrainPaperRecommendation>;
  }): PendingPaperOrderInput[] {
    if (screen.asOf === null) {
      return [];
    }
    const dataAsOf = new Date(`${screen.asOf}T00:00:00.000Z`);
    const targetTradeDate = nextWeekday(decidedAt);
    return [...constrained.sells, ...constrained.buys].map((order) => ({
      tickerId: order.tickerId,
      side: order.side,
      quantity: String(order.quantity),
      strategy,
      reason: order.reason,
      decidedAt,
      dataAsOf,
      targetTradeDate,
      status: 'PENDING' as const,
      indicatorSnapshot: indicatorsByTickerId.get(order.tickerId) ?? null,
      agentRunId,
    }));
  }
}

// 종가를 못 구한 매도는 0 원이 아니라 '금액 미상' 이다 — 둘을 같은 값으로 뭉치지 않는다.
const estimatedAmountOf = (
  quantity: number,
  close: number | undefined,
): number | null => {
  if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) {
    return null;
  }
  return quantity * close;
};

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
