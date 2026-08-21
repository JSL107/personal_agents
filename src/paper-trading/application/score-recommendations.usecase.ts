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
import {
  PaperTradingPrismaRepository,
  SaveRecommendationScoreInput,
} from '../infrastructure/paper-trading.prisma.repository';

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
  // 위 shadowUnavailable 중 "보유 기간이 아직 안 찼다" 인 건수. 시세가 빠진 것과 때가
  // 오지 않은 것을 한 숫자로 보고하면 읽는 사람이 고장으로 오해한다.
  shadowNotDue: number;
  anomaly: number;
  realizedPnlMismatch: number;
}

export interface AccountRecommendationScore {
  accountId: number;
  accountName: string;
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
  // 이 성적이 어느 규칙 버전의 추천에서 나왔는지. 둘 이상이면 규칙이 바뀐 구간을 걸친 집계다.
  ruleVersions: number[];
  // 버전이 안 적힌 추천 수. 0 이 아니면 위 목록만으로는 표본을 다 설명하지 못한다.
  unknownRuleVersionCount: number;
  score: StrategyRecommendationScore;
  meanExcessReturnRate: string | null;
  meanShadowReturnRate: string | null;
  // 평가일 지수가 아직 안 들어와 초과수익 집계가 통째로 막힌 회차인가.
  evaluationBenchmarkMissing: boolean;
  portfolio: PortfolioPerformance;
  classifications: RecommendationClassifications;
  exclusions: RecommendationScoreExclusions;
}

export interface ScoreRecommendationsResult {
  asOf: Date;
  from: Date | null;
  // 이 회차를 원장에 남겼는지. 남기지 않은 이유는 아래 저장 조건 주석 참조.
  persisted: boolean;
  // 평가일 지수가 아직 안 들어와 초과수익이 통째로 빠진 회차인가. 저장을 막는 조건이자
  // 카드에 "고장이 아니라 순서 문제" 임을 적기 위한 값이다.
  evaluationBenchmarkMissing: boolean;
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
  constructor(private readonly repository: PaperTradingPrismaRepository) {}

  async execute(
    command: ScoreRecommendationsCommand,
  ): Promise<ScoreRecommendationsResult> {
    const today = new Date(`${getTodayKstDate()}T00:00:00.000Z`);
    const asOf = command.asOf ?? today;
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
        ruleVersions: [
          ...new Set(
            accountOrders.flatMap((order) =>
              order.ruleVersion === null ? [] : [order.ruleVersion],
            ),
          ),
        ].sort((left, right) => left - right),
        unknownRuleVersionCount: accountOrders.filter(
          (order) => order.ruleVersion === null,
        ).length,
        score,
        meanExcessReturnRate: benchmark.meanExcessReturnRate,
        meanShadowReturnRate,
        evaluationBenchmarkMissing: benchmark.evaluationBenchmarkMissing,
        portfolio,
        classifications,
        exclusions: {
          expired: classifications.expired,
          benchmarkUnavailable: benchmark.benchmarkUnavailableCount,
          shadowUnavailable: shadow.shadowUnavailableCount,
          shadowNotDue: shadow.shadowNotDueCount,
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
        shadowNotDue: totals.shadowNotDue + account.exclusions.shadowNotDue,
        anomaly: totals.anomaly + account.exclusions.anomaly,
        realizedPnlMismatch:
          totals.realizedPnlMismatch + account.exclusions.realizedPnlMismatch,
      }),
      {
        expired: 0,
        benchmarkUnavailable: 0,
        shadowUnavailable: 0,
        shadowNotDue: 0,
        anomaly: 0,
        realizedPnlMismatch: 0,
      },
    );

    // 원장에 남기는 회차를 둘로 좁힌다.
    //
    // 구간 집계(from 지정)는 탐색용 조회다. 같은 기준일의 누적 성적 행을 구간 성적으로
    // 덮어쓰면 그 행이 무엇을 잰 숫자인지 알 수 없게 된다.
    //
    // 과거 기준일 재채점도 남기지 않는다. 거래는 tradeDate 로 잘라 시점이 복원되지만
    // 주문 상태(PaperOrder.status)는 이력이 없어 현재값을 읽는다. 그날 대기 중이던 주문이
    // 지금은 만료로 잡히므로, 뒤늦게 과거 날짜를 다시 채점하면 "그날의 성적" 이 아닌 숫자가
    // 그날 행을 덮어쓴다. 상태 이력이 생기기 전까지는 오늘 기준일만 정본으로 인정한다.
    //
    // 평가일 지수가 없는 회차도 남기지 않는다. 초과수익은 진입일과 청산일 지수를 모두
    // 요구하고 보유 중인 추천은 청산일이 곧 평가일이라, 지수가 하루 비면 그 회차 전건이
    // 집계에서 빠진다. 그대로 저장하면 "성적을 못 낸 날" 이 원장에 영구히 박히는데,
    // 위 규칙 때문에 과거 기준일은 다시 채점해 덮을 수도 없다. 2026-08-19 행이 실제로
    // 그렇게 남았다 — 그날 채점을 지수 수집(18:30)보다 먼저 수동 실행한 결과다.
    // 자동 경로(금 20:10)는 수집 뒤라 이 가드에 걸리지 않는다.
    // 실제로 집계에서 빠진 건이 있는 회차만 막는다. 판단 근거는 제외 건수 그 자체다 —
    // "평가일 지수가 없다" 만으로는 부족하다. 평가일 전에 모두 청산된 계좌는 각 추천의
    // 초과수익이 매도일 지수만으로 온전히 산출되므로, 그런 회차까지 막으면 멀쩡한 성적이
    // 원장에 남지 못한다. 추천이 0건인 회차도 같은 이유로 통과한다(빠진 것이 없다).
    const evaluationBenchmarkMissing = accounts.some(
      (account) =>
        account.evaluationBenchmarkMissing &&
        account.exclusions.benchmarkUnavailable > 0,
    );
    const persisted =
      command.from === undefined &&
      asOf.getTime() === today.getTime() &&
      !evaluationBenchmarkMissing;
    if (persisted) {
      await this.repository.saveRecommendationScores(
        accounts.map((account) => toSaveInput(account, asOf)),
      );
    }

    return {
      asOf,
      from: command.from ?? null,
      persisted,
      evaluationBenchmarkMissing,
      accounts,
      classifications,
      exclusions,
    };
  }
}

const toSaveInput = (
  account: AccountRecommendationScore,
  asOf: Date,
): SaveRecommendationScoreInput => ({
  accountId: account.accountId,
  strategy: account.strategy,
  asOf,
  ruleVersions: account.ruleVersions,
  unknownRuleVersionCount: account.unknownRuleVersionCount,
  recommendationCount: account.score.recommendationCount,
  closedCount: account.score.closedCount,
  openCount: account.score.openCount,
  expiredCount: account.score.expiredCount,
  hitCount: account.score.hitCount,
  hitRate: account.score.hitRate,
  meanReturnRate: account.score.meanReturnRate,
  medianReturnRate: account.score.medianReturnRate,
  maximumLoss: account.score.maximumLoss,
  averageHoldingDays: account.score.averageHoldingDays,
  meanExcessReturnRate: account.meanExcessReturnRate,
  meanShadowReturnRate: account.meanShadowReturnRate,
  snapshotCount: account.portfolio.snapshotCount,
  accountReturnRate: account.portfolio.accountReturnRate,
  maximumDrawdown: account.portfolio.maximumDrawdown,
  turnoverRate: account.portfolio.turnoverRate,
  cumulativeCost: account.portfolio.cumulativeCost,
  exclusions: { ...account.exclusions },
});
