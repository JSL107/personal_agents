import { Injectable } from '@nestjs/common';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { TradeStrategy } from '../domain/paper-account.type';
import {
  calculatePortfolioPerformance,
  PortfolioPerformance,
} from '../domain/portfolio-performance';
import {
  aggregateRecommendationScores,
  matchRecommendationCycles,
  StrategyRecommendationScore,
} from '../domain/recommendation-score';
import {
  calculateBenchmarkPerformance,
  calculateShadowPerformance,
} from '../domain/shadow-performance';
import { PaperTradingRepository } from '../infrastructure/paper-trading.repository';

export interface ScoreRecommendationsCommand {
  asOf?: Date;
  from?: Date;
}

export interface RecommendationClassifications {
  closed: number;
  open: number;
  expired: number;
  anomaly: number;
}

export interface RecommendationScoreExclusions {
  expired: number;
  benchmarkUnavailable: number;
  shadowUnavailable: number;
  anomaly: number;
  realizedPnlMismatch: number;
}

export interface AccountRecommendationScore {
  accountId: number;
  accountName: string;
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
  score: StrategyRecommendationScore;
  meanExcessReturnRate: string | null;
  meanShadowReturnRate: string | null;
  portfolio: PortfolioPerformance;
  classifications: RecommendationClassifications;
  exclusions: RecommendationScoreExclusions;
}

export interface ScoreRecommendationsResult {
  asOf: Date;
  from: Date | null;
  accounts: AccountRecommendationScore[];
  classifications: RecommendationClassifications;
  exclusions: RecommendationScoreExclusions;
}

const emptyScore = (
  strategy: Exclude<TradeStrategy, 'MANUAL'>,
): StrategyRecommendationScore => ({
  strategy,
  recommendationCount: 0,
  closedCount: 0,
  openCount: 0,
  expiredCount: 0,
  hitCount: 0,
  hitRate: null,
  meanReturnRate: null,
  medianReturnRate: null,
  maximumLoss: null,
  averageHoldingDays: null,
  anomalyCount: 0,
  realizedPnlMismatchCount: 0,
});

const countClassifications = (
  classifications: Array<{ classification: string }>,
): RecommendationClassifications =>
  classifications.reduce<RecommendationClassifications>(
    (counts, item) => {
      const key =
        item.classification.toLowerCase() as keyof RecommendationClassifications;
      counts[key] += 1;
      return counts;
    },
    { closed: 0, open: 0, expired: 0, anomaly: 0 },
  );

@Injectable()
export class ScoreRecommendationsUsecase {
  constructor(private readonly repository: PaperTradingRepository) {}

  async execute(
    command: ScoreRecommendationsCommand,
  ): Promise<ScoreRecommendationsResult> {
    const asOf = command.asOf ?? new Date(`${getTodayKstDate()}T00:00:00.000Z`);
    const data = await this.repository.loadRecommendationScoreData({
      asOf,
      from: command.from,
    });
    const matched = matchRecommendationCycles({
      orders: data.orders,
      trades: data.recommendationTrades,
    });
    const validDailyPrices = data.dailyPrices.flatMap((dailyPrice) =>
      dailyPrice.market === null
        ? []
        : [{ ...dailyPrice, market: dailyPrice.market }],
    );
    const accounts = data.accounts.map((account) => {
      const strategy = account.name;
      const accountOrders = data.orders.filter(
        (order) => order.accountId === account.id,
      );
      const accountTrades = data.recommendationTrades.filter(
        (trade) => trade.accountId === account.id,
      );
      const accountMatched = matchRecommendationCycles({
        orders: accountOrders,
        trades: accountTrades,
      });
      const score =
        aggregateRecommendationScores(accountMatched).find(
          (candidate) => candidate.strategy === strategy,
        ) ?? emptyScore(strategy);
      const shadow = calculateShadowPerformance({
        cycles: accountMatched.cycles,
        dailyPrices: validDailyPrices,
      });
      const benchmark = calculateBenchmarkPerformance({
        cycles: accountMatched.cycles,
        evaluationDate: asOf,
        dailyPrices: validDailyPrices,
        benchmarkCloses: data.benchmarkCloses,
      });
      const classifications = countClassifications(accountMatched.cycles);
      const nullMarketCycleCount = new Set(
        accountMatched.cycles
          .filter((cycle) =>
            data.dailyPrices.some(
              (dailyPrice) =>
                dailyPrice.tickerId === cycle.tickerId &&
                dailyPrice.market === null,
            ),
          )
          .map((cycle) => cycle.orderId),
      ).size;
      const meanShadowReturnRate =
        shadow.performances.length === 0
          ? null
          : shadow.performances
              .slice(1)
              .reduce(
                (sum, performance) => sum.plus(performance.returnRate),
                account.seedAmount
                  .times(0)
                  .plus(shadow.performances[0].returnRate),
              )
              .dividedBy(shadow.performances.length)
              .toString();
      const portfolio = calculatePortfolioPerformance({
        seedAmount: account.seedAmount,
        snapshots: data.snapshots
          .filter((snapshot) => snapshot.accountId === account.id)
          .map((snapshot) => ({
            tradeDate: snapshot.tradeDate,
            totalValue: snapshot.totalValue,
            isBackfilled: snapshot.isBackfilled,
          })),
        trades: data.portfolioTrades.filter(
          (trade) => trade.accountId === account.id,
        ),
      });

      return {
        accountId: account.id,
        accountName: account.name,
        strategy,
        score,
        meanExcessReturnRate: benchmark.meanExcessReturnRate,
        meanShadowReturnRate,
        portfolio,
        classifications,
        exclusions: {
          expired: classifications.expired,
          benchmarkUnavailable: benchmark.benchmarkUnavailableCount,
          shadowUnavailable: shadow.shadowUnavailableCount,
          anomaly: accountMatched.anomalies.length + nullMarketCycleCount,
          realizedPnlMismatch: accountMatched.realizedPnlMismatchCount,
        },
      };
    });
    const classifications = countClassifications(matched.cycles);
    const exclusions = accounts.reduce<RecommendationScoreExclusions>(
      (totals, account) => ({
        expired: totals.expired + account.exclusions.expired,
        benchmarkUnavailable:
          totals.benchmarkUnavailable + account.exclusions.benchmarkUnavailable,
        shadowUnavailable:
          totals.shadowUnavailable + account.exclusions.shadowUnavailable,
        anomaly: totals.anomaly + account.exclusions.anomaly,
        realizedPnlMismatch:
          totals.realizedPnlMismatch + account.exclusions.realizedPnlMismatch,
      }),
      {
        expired: 0,
        benchmarkUnavailable: 0,
        shadowUnavailable: 0,
        anomaly: 0,
        realizedPnlMismatch: 0,
      },
    );

    return {
      asOf,
      from: command.from ?? null,
      accounts,
      classifications,
      exclusions,
    };
  }
}
