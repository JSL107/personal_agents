import { Prisma } from '@prisma/client';

import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { ScoreRecommendationsUsecase } from './score-recommendations.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('ScoreRecommendationsUsecase', () => {
  const repository = {
    loadRecommendationScoreData: jest.fn(),
    saveRecommendationScores: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('계좌별 실제·그림자·벤치마크·포트폴리오 성적과 제외 사유를 집계한다', async () => {
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [
        { id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') },
        { id: 8, name: 'SWING', seedAmount: decimal('1000') },
      ],
      orders: [
        {
          id: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: 2,
        },
        {
          id: 302,
          accountId: 8,
          tickerId: 72,
          side: 'BUY',
          strategy: 'SWING',
          status: 'EXPIRED',
          quantity: decimal('1'),
          ruleVersion: null,
        },
      ],
      recommendationTrades: [
        {
          id: 501,
          orderId: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          quantity: decimal('1'),
          price: decimal('100'),
          fee: decimal('1'),
          tax: decimal('0'),
          realizedPnl: null,
          tradeDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          id: 502,
          orderId: null,
          accountId: 7,
          tickerId: 71,
          side: 'SELL',
          quantity: decimal('1'),
          price: decimal('120'),
          fee: decimal('1'),
          tax: decimal('1'),
          realizedPnl: decimal('17'),
          tradeDate: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
      portfolioTrades: [
        {
          accountId: 7,
          quantity: decimal('1'),
          price: decimal('100'),
          fee: decimal('1'),
          tax: decimal('0'),
        },
      ],
      dailyPrices: Array.from({ length: 61 }, (_, index) => ({
        tickerId: 71,
        market: 'KOSPI',
        tradeDate: new Date(Date.UTC(2026, 5, 1 + index)),
        close: decimal(index === 60 ? '120' : '100'),
      })),
      benchmarkCloses: [
        {
          tradeDate: new Date('2026-06-01T00:00:00.000Z'),
          close: decimal('100'),
        },
        {
          tradeDate: new Date('2026-08-01T00:00:00.000Z'),
          close: decimal('110'),
        },
      ],
      snapshots: [
        {
          accountId: 7,
          tradeDate: asOf,
          totalValue: decimal('1100'),
          isBackfilled: false,
        },
      ],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({ asOf });

    expect(result.classifications).toEqual({
      closed: 1,
      open: 0,
      expired: 1,
      anomaly: 0,
    });
    expect(result.exclusions).toEqual({
      expired: 1,
      benchmarkUnavailable: 0,
      shadowUnavailable: 0,
      shadowNotDue: 0,
      anomaly: 0,
      realizedPnlMismatch: 0,
    });
    expect(result.accounts[0]).toEqual(
      expect.objectContaining({
        accountName: 'LONG_TERM',
        strategy: 'LONG_TERM',
        meanExcessReturnRate: expect.any(String),
        meanShadowReturnRate: expect.any(String),
        portfolio: expect.objectContaining({
          accountReturnRate: '0.1',
          snapshotCount: 1,
        }),
        classifications: {
          closed: 1,
          open: 0,
          expired: 0,
          anomaly: 0,
        },
        exclusions: {
          expired: 0,
          benchmarkUnavailable: 0,
          shadowUnavailable: 0,
          shadowNotDue: 0,
          anomaly: 0,
          realizedPnlMismatch: 0,
        },
      }),
    );
    expect(result.accounts[0].ruleVersions).toEqual([2]);
    expect(result.accounts[0].unknownRuleVersionCount).toBe(0);
    // 버전을 적기 전에 만들어진 추천은 버전 목록에 끼워 넣지 않고 건수로 따로 센다.
    expect(result.accounts[1].ruleVersions).toEqual([]);
    expect(result.accounts[1].unknownRuleVersionCount).toBe(1);
    expect(result.accounts[1]).toEqual(
      expect.objectContaining({
        score: expect.objectContaining({
          recommendationCount: 1,
          expiredCount: 1,
        }),
        classifications: {
          closed: 0,
          open: 0,
          expired: 1,
          anomaly: 0,
        },
        exclusions: {
          expired: 1,
          benchmarkUnavailable: 0,
          shadowUnavailable: 0,
          shadowNotDue: 0,
          anomaly: 0,
          realizedPnlMismatch: 0,
        },
      }),
    );
  });

  it('krxMarket null을 조용히 버리지 않고 anomaly와 shadow unavailable로 센다', async () => {
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [
        {
          id: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: 2,
        },
      ],
      recommendationTrades: [
        {
          id: 501,
          orderId: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          quantity: decimal('1'),
          price: decimal('100'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: null,
          tradeDate: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
      portfolioTrades: [],
      dailyPrices: [
        {
          tickerId: 71,
          market: null,
          tradeDate: new Date('2026-08-01T00:00:00.000Z'),
          close: decimal('100'),
        },
      ],
      benchmarkCloses: [],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({ asOf });

    expect(result.exclusions.anomaly).toBe(1);
    expect(result.exclusions.shadowUnavailable).toBe(1);
    expect(result.classifications.open).toBe(1);
    expect(result.accounts[0].classifications).toEqual({
      closed: 0,
      open: 1,
      expired: 0,
      anomaly: 0,
    });
    expect(result.accounts[0].exclusions).toEqual({
      expired: 0,
      benchmarkUnavailable: 1,
      shadowUnavailable: 1,
      shadowNotDue: 0,
      anomaly: 1,
      realizedPnlMismatch: 0,
    });
  });

  it('계좌별 채점 결과를 규칙 버전과 함께 원장에 저장한다', async () => {
    // 원장에 남는 회차는 기준일이 KST 오늘일 때뿐이라 시계를 그날로 고정한다.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T03:00:00.000Z'));
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [
        {
          id: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: 3,
        },
        {
          id: 302,
          accountId: 7,
          tickerId: 72,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: 2,
        },
        {
          id: 303,
          accountId: 7,
          tickerId: 73,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: null,
        },
      ],
      recommendationTrades: [
        {
          id: 501,
          orderId: 301,
          accountId: 7,
          tickerId: 71,
          side: 'BUY',
          quantity: decimal('1'),
          price: decimal('100'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: null,
          tradeDate: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
      portfolioTrades: [],
      dailyPrices: [],
      // 평가일 지수가 없으면 초과수익이 통째로 빠져 그 회차는 저장되지 않는다.
      // 이 테스트가 보려는 것은 저장 경로이므로 지수를 갖춘 정상 회차로 둔다.
      benchmarkCloses: [{ tradeDate: asOf, close: decimal('2500') }],
      snapshots: [
        {
          accountId: 7,
          tradeDate: asOf,
          totalValue: decimal('1100'),
          isBackfilled: false,
        },
      ],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({ asOf });

    expect(repository.saveRecommendationScores).toHaveBeenCalledTimes(1);
    const [saved] = repository.saveRecommendationScores.mock.calls[0][0];
    expect(saved).toEqual(
      expect.objectContaining({
        accountId: 7,
        strategy: 'LONG_TERM',
        asOf,
        // 중복은 접고 오름차순으로 — 두 값이 남았다는 것 자체가 "규칙이 바뀐 구간을 걸쳤다" 는 사실이다.
        ruleVersions: [2, 3],
        unknownRuleVersionCount: 1,
        recommendationCount: result.accounts[0].score.recommendationCount,
        accountReturnRate: '0.1',
        snapshotCount: 1,
        exclusions: result.accounts[0].exclusions,
      }),
    );
    expect(result.persisted).toBe(true);
    jest.useRealTimers();
  });

  // 원장에 남기는 것이 이 채점의 목적이라 저장 실패를 삼키지 않는다. 삼키면 슬랙에는 성적이
  // 뜨는데 원장에는 아무것도 없는 회차가 조용히 생기고, 나중에 그 구멍을 설명할 수 없다.
  it('원장 저장이 실패하면 성적을 반환하지 않고 실패를 그대로 올린다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T03:00:00.000Z'));
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [],
      recommendationTrades: [],
      portfolioTrades: [],
      dailyPrices: [],
      benchmarkCloses: [],
      snapshots: [],
    });
    repository.saveRecommendationScores.mockRejectedValue(
      new Error('원장 저장 실패'),
    );
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    await expect(usecase.execute({ asOf })).rejects.toThrow('원장 저장 실패');
    jest.useRealTimers();
  });

  // 초과수익은 진입일과 청산일 지수를 모두 요구하고 보유 중인 추천은 청산일이 곧 평가일이라,
  // 그날 지수가 없으면 전건이 빠진 성적이 나온다. 2026-08-19 채점이 지수 수집(18:30)보다
  // 먼저 돌아 그 상태로 원장에 박힌 적이 있고, 과거 기준일은 다시 채점해 덮을 수도 없다.
  it('평가일 지수가 없는데 집계 대상이 있으면 원장에 남기지 않는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T03:00:00.000Z'));
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [
        {
          id: 1,
          accountId: 7,
          tickerId: 100,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: 2,
        },
      ],
      recommendationTrades: [
        {
          id: 11,
          orderId: 1,
          accountId: 7,
          tickerId: 100,
          side: 'BUY',
          quantity: decimal('1'),
          price: decimal('100'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: null,
          tradeDate: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
      portfolioTrades: [],
      dailyPrices: [],
      benchmarkCloses: [],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({ asOf });

    expect(result.evaluationBenchmarkMissing).toBe(true);
    expect(result.persisted).toBe(false);
    expect(repository.saveRecommendationScores).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  // 평가일 전에 모두 청산된 계좌는 각 추천의 초과수익이 매도일 지수만으로 온전히 나온다.
  // 평가일 지수 유무만 보고 막으면 멀쩡한 성적이 원장에 남지 못한다 — 판단 근거는 실제로
  // 빠진 건수여야 한다.
  it('평가일 지수가 없어도 집계에서 빠진 건이 없으면 원장에 남긴다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T03:00:00.000Z'));
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    const buyDate = new Date('2026-08-03T00:00:00.000Z');
    const sellDate = new Date('2026-08-05T00:00:00.000Z');
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [
        {
          id: 1,
          accountId: 7,
          tickerId: 100,
          side: 'BUY',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: 2,
        },
        {
          id: 2,
          accountId: 7,
          tickerId: 100,
          side: 'SELL',
          strategy: 'LONG_TERM',
          status: 'FILLED',
          quantity: decimal('1'),
          ruleVersion: null,
        },
      ],
      recommendationTrades: [
        {
          id: 11,
          orderId: 1,
          accountId: 7,
          tickerId: 100,
          side: 'BUY',
          quantity: decimal('1'),
          price: decimal('100'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: null,
          tradeDate: buyDate,
        },
        {
          id: 12,
          orderId: 2,
          accountId: 7,
          tickerId: 100,
          side: 'SELL',
          quantity: decimal('1'),
          price: decimal('110'),
          fee: decimal('0'),
          tax: decimal('0'),
          realizedPnl: decimal('10'),
          tradeDate: sellDate,
        },
      ],
      portfolioTrades: [],
      dailyPrices: [],
      // 매수일과 매도일 지수는 있고 평가일(8/13) 지수만 없다.
      benchmarkCloses: [
        { tradeDate: buyDate, close: decimal('2500') },
        { tradeDate: sellDate, close: decimal('2550') },
      ],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({ asOf });

    expect(result.exclusions.benchmarkUnavailable).toBe(0);
    expect(result.accounts[0].meanExcessReturnRate).not.toBeNull();
    expect(result.persisted).toBe(true);
    expect(repository.saveRecommendationScores).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  // 추천이 0건이면 지수가 없어도 잃는 숫자가 없다. 여기까지 막으면 표본이 없는 초기 구간의
  // 채점이 영영 원장에 남지 않는다 — 차단은 실제로 집계가 막힌 회차에만 걸려야 한다.
  it('집계 대상이 없으면 평가일 지수가 없어도 원장에 남긴다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T03:00:00.000Z'));
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [],
      recommendationTrades: [],
      portfolioTrades: [],
      dailyPrices: [],
      benchmarkCloses: [],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      asOf: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(result.persisted).toBe(true);
    expect(repository.saveRecommendationScores).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  // 거래는 tradeDate 로 잘려 시점이 복원되지만 주문 상태는 이력이 없어 현재값을 읽는다.
  // 그날 대기 중이던 주문이 지금은 만료로 잡히므로 뒤늦은 재채점을 그날 행으로 저장하면
  // "그날의 성적" 이 아닌 숫자가 원장에 남는다.
  it('과거 기준일 재채점은 그날 행을 덮어쓰지 않도록 원장에 남기지 않는다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T03:00:00.000Z'));
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [],
      recommendationTrades: [],
      portfolioTrades: [],
      dailyPrices: [],
      benchmarkCloses: [],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      asOf: new Date('2026-08-13T00:00:00.000Z'),
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.persisted).toBe(false);
    expect(repository.saveRecommendationScores).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('구간 집계는 누적 성적 행을 덮어쓰지 않도록 원장에 남기지 않는다', async () => {
    // 기준일은 오늘로 둔다 — 저장이 막히는 이유가 구간 지정 하나임을 분리하기 위해서다.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T03:00:00.000Z'));
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [{ id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') }],
      orders: [],
      recommendationTrades: [],
      portfolioTrades: [],
      dailyPrices: [],
      benchmarkCloses: [],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      asOf: new Date('2026-08-13T00:00:00.000Z'),
      from: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(result.accounts).toHaveLength(1);
    expect(result.persisted).toBe(false);
    expect(repository.saveRecommendationScores).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('입력 생략 시 KST 오늘을 UTC 날짜 경계로 정규화하고 빈 표본도 두 계좌 결과로 반환한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T16:30:00.000Z'));
    repository.loadRecommendationScoreData.mockResolvedValue({
      accounts: [
        { id: 7, name: 'LONG_TERM', seedAmount: decimal('1000') },
        { id: 8, name: 'SWING', seedAmount: decimal('1000') },
      ],
      orders: [],
      recommendationTrades: [],
      portfolioTrades: [],
      dailyPrices: [],
      benchmarkCloses: [],
      snapshots: [],
    });
    const usecase = new ScoreRecommendationsUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({});

    expect(result.asOf).toEqual(new Date('2026-08-14T00:00:00.000Z'));
    expect(result.from).toBeNull();
    expect(repository.loadRecommendationScoreData).toHaveBeenCalledWith({
      asOf: result.asOf,
      from: undefined,
    });
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts[0].score.closedCount).toBe(0);
    jest.useRealTimers();
  });
});
