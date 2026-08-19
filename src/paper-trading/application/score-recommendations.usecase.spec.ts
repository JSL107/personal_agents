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
          anomaly: 0,
          realizedPnlMismatch: 0,
        },
      }),
    );
    expect(result.accounts[0].ruleVersions).toEqual([2]);
    // 버전을 적기 전에 만들어진 추천은 0 이나 1 로 뭉뚱그리지 않는다 — 모르는 것은 빈 값이다.
    expect(result.accounts[1].ruleVersions).toEqual([]);
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
      anomaly: 1,
      realizedPnlMismatch: 0,
    });
  });

  it('계좌별 채점 결과를 규칙 버전과 함께 원장에 저장한다', async () => {
    const asOf = new Date('2026-08-13T00:00:00.000Z');
    const from = new Date('2026-07-01T00:00:00.000Z');
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
      dailyPrices: [],
      benchmarkCloses: [],
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

    const result = await usecase.execute({ asOf, from });

    expect(repository.saveRecommendationScores).toHaveBeenCalledTimes(1);
    const [saved] = repository.saveRecommendationScores.mock.calls[0][0];
    expect(saved).toEqual(
      expect.objectContaining({
        accountId: 7,
        strategy: 'LONG_TERM',
        asOf,
        fromDate: from,
        // 중복은 접고 오름차순으로 — 두 값이 남았다는 것 자체가 "규칙이 바뀐 구간을 걸쳤다" 는 사실이다.
        ruleVersions: [2, 3],
        recommendationCount: result.accounts[0].score.recommendationCount,
        accountReturnRate: '0.1',
        snapshotCount: 1,
        exclusions: result.accounts[0].exclusions,
      }),
    );
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
