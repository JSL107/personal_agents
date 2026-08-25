import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { StockIndicators } from '../../../market-data/domain/stock-indicator';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { OpenPaperAccountUsecase } from '../../../paper-trading/application/open-paper-account.usecase';
import { parseTradeSide } from '../../../paper-trading/domain/paper-account.type';
import { PaperAccountRecord } from '../../../paper-trading/domain/port/paper-order-ledger.port';
import { nextWeekday } from '../../../paper-trading/domain/trade-calendar';
import {
  LockedPaperRecommendationState,
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
import { planPendingOrders } from '../domain/pending-order-plan';
import {
  buildPaperRecommendationPrompt,
  PAPER_RECOMMEND_SYSTEM_PROMPT,
} from '../domain/prompt/paper-recommend-system.prompt';
import { renderRecommendationScorecard } from '../domain/prompt/recommendation-scorecard';

const PAPER_ACCOUNT_SEED_AMOUNT = '10000000';

// 프롬프트에 실을 채점 회차 수. 회차가 주 1회라 3이면 최근 3주다 — 더 늘리면 밴드를 바꾸기
// 전 성적까지 섞여 지금 규칙의 성적으로 읽히지 않는다.
const SCORECARD_ROUNDS = 3;
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
  private readonly logger = new Logger(GeneratePaperRecommendationUsecase.name);

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
          // 운영 회차만 원장에 남긴다. 여기서 보여준 목록이 곧 "모델이 보고도 안 산 것" 의
          // 모집단이라, 나중에 규칙을 고칠 때 대조군이 되는 유일한 회차다.
          // 회차는 모델 호출보다 먼저 확정되므로 실행 id 를 함께 남긴다 — 이 실행이
          // 실패한 날은 주문이 없어, id 없이는 "다 보고 아무것도 안 샀다" 와 구분되지 않는다.
          record: { agentRunId },
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
        const scorecard = await this.buildScorecard(strategy);
        const prompt =
          buildPaperRecommendationPrompt({
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
          }) + scorecard;
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
    const codesByTickerId = new Map([
      ...screen.stocks.map((stock): [number, string] => [
        stock.tickerId,
        stock.code,
      ]),
      ...state.positions.map((position): [number, string] => [
        position.tickerId,
        position.ticker.code,
      ]),
    ]);
    const plan = planPendingOrders({
      pendingOrders: state.existingOrders.map((order) => {
        const snapshot = order.indicatorSnapshot as {
          close?: unknown;
        } | null;
        const close =
          typeof snapshot?.close === 'number' && Number.isFinite(snapshot.close)
            ? snapshot.close
            : null;
        return {
          tickerId: order.tickerId,
          // DB 의 side 는 제약 없는 문자열 컬럼이다. 캐스팅으로 넘기면 알 수 없는 값이
          // 매수로 취급돼 조용히 현금을 예약한다 — 도메인 파서로 걸러 즉시 실패시킨다.
          side: parseTradeSide(order.side),
          quantity: Number(order.quantity.toString()),
          close,
        };
      }),
      cashBalance: Number(state.account.cashBalance.toString()),
      codeOf: (tickerId) => codesByTickerId.get(tickerId),
    });
    // 대기 주문이 있는 종목은 이번 회차 추천에서 아예 뺀다. 제약 함수 뒤에서 버리면 그
    // 종목이 먼저 먹은 현금과 매수 건수가 되돌아오지 않아, 뒤의 유효한 매수가 상한에 걸려
    // 사라진다(매수 3건 상한에서 충돌 1건이 자리를 먹으면 4번째 후보가 통째로 유실된다).
    // 걸린 건은 skipped 에 남긴다 — 그대로 두면 Slack 이 '추천 없음' 으로 단정한다.
    const pendingCodes = new Set([
      ...plan.pendingBuyCodes,
      ...plan.pendingSellCodes,
    ]);
    const pendingSkips: PaperRecommendationSkip[] = [];
    const withoutPendingOrders = <T extends { code: string }>(
      intents: T[],
      side: 'BUY' | 'SELL',
    ): T[] =>
      intents.filter((intent) => {
        if (!pendingCodes.has(intent.code)) {
          return true;
        }
        pendingSkips.push({
          side,
          code: intent.code,
          reason: 'PENDING_ORDER_EXISTS',
        });
        return false;
      });
    const constrained = constrainPaperRecommendation({
      recommendation: {
        sells: withoutPendingOrders(recommendation.sells, 'SELL'),
        buys: withoutPendingOrders(recommendation.buys, 'BUY'),
      },
      candidates: screen.stocks.map((stock) => ({
        tickerId: stock.tickerId,
        code: stock.code,
        name: stock.name,
        close: stock.indicators.close,
      })),
      positions: state.positions.map((position) => ({
        tickerId: position.tickerId,
        code: position.ticker.code,
        quantity: Number(position.quantity.toString()),
      })),
      cashBalance: plan.availableCash,
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
        skipped: [...pendingSkips, ...constrained.skipped],
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
      ruleVersion: screen.ruleVersion,
      agentRunId,
    }));
  }

  /**
   * 지난 회차 성적을 프롬프트 블록으로 만든다. 조회 실패는 성적 없이 진행(best-effort) —
   * 되먹임이 없다고 추천 자체를 막으면 하루치 회차가 통째로 사라진다.
   */
  private async buildScorecard(
    strategy: PaperRecommendationStrategy,
  ): Promise<string> {
    try {
      const rows = await this.repository.findRecentRecommendationScores({
        strategy,
        limit: SCORECARD_ROUNDS,
      });
      const block = renderRecommendationScorecard(rows);
      if (block.length > 0) {
        this.logger.log(
          `추천 성적표 주입 (${strategy}): ${rows.length}회차 · 청산 ${rows.reduce((sum, row) => sum + row.closedCount, 0)}건`,
        );
      }
      return block;
    } catch (error) {
      this.logger.warn(
        `추천 성적표 조회 실패, 성적 없이 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return '';
    }
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
