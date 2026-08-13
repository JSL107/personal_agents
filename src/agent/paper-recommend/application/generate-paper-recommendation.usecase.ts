import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { StockIndicators } from '../../../market-data/domain/stock-indicator';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { OpenPaperAccountUsecase } from '../../../paper-trading/application/open-paper-account.usecase';
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
import {
  constrainPaperRecommendation,
  nextWeekday,
} from '../domain/paper-recommendation.constraint';
import { parsePaperRecommendation } from '../domain/paper-recommendation.parser';
import { PaperRecommendationStrategy } from '../domain/paper-recommendation.type';
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
}

export interface PaperRecommendationFailure {
  strategy: PaperRecommendationStrategy;
  message: string;
}

export interface GeneratePaperRecommendationResult {
  completed: PaperRecommendationSuccess[];
  failed: PaperRecommendationFailure[];
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
            const orders = this.constrainLockedRecommendation({
              strategy,
              decidedAt,
              screen,
              indicatorsByTickerId,
              agentRunId,
              recommendation,
              state,
            });
            return {
              result: {
                strategy,
                accountId: account.id,
                ordersCreated: orders.length,
                agentRunId,
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
  }): PendingPaperOrderInput[] {
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
    const constrained = constrainPaperRecommendation({
      recommendation: {
        ...recommendation,
        sells: recommendation.sells.filter((sell) => {
          const position = state.positions.find(
            (item) => item.ticker.code === sell.code,
          );
          if (position) {
            return !pendingSellTickerIds.has(position.tickerId);
          }
          const candidate = screen.stocks.find(
            (stock) => stock.code === sell.code,
          );
          return !candidate || !pendingSellTickerIds.has(candidate.tickerId);
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
    return this.toPendingOrders({
      strategy,
      decidedAt,
      screen,
      indicatorsByTickerId,
      agentRunId,
      constrained,
    });
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

const errorMessageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
