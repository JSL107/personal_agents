import { StockIndicators } from '../../market-data/domain/stock-indicator';
import {
  ScreenCandidate,
  SCREENER_RULE_VERSION,
  screenStocks,
} from './screener-rule';

const LIQUID_TURNOVER60 = 600_000_000;

const indicators = (
  overrides: Partial<StockIndicators> = {},
): StockIndicators => ({
  close: 130,
  ma5: 125,
  ma20: 120,
  ma60: 110,
  ma120: 100,
  isAligned: true,
  volumeSurge: 2,
  return1m: 10,
  return3m: 20,
  return6m: 30,
  high200Position: 0.9,
  volatility20: 15,
  turnover60: LIQUID_TURNOVER60,
  barCount: 200,
  ...overrides,
});

const candidate = (
  code: string,
  overrides: Partial<StockIndicators> = {},
): ScreenCandidate => ({
  tickerId: Number(code),
  code,
  name: `종목${code}`,
  krxMarket: 'KOSPI',
  indicators: indicators(overrides),
});

describe('screenStocks', () => {
  it('장투 통과 후보가 하나면 100점이다', () => {
    expect(SCREENER_RULE_VERSION).toBe(2);
    expect(screenStocks([candidate('000001')], 'LONG_TERM', 20)).toEqual([
      expect.objectContaining({ code: '000001', score: 100 }),
    ]);
  });

  it.each(['LONG_TERM', 'SWING'] as const)(
    '%s는 60일 평균 거래대금이 5억원 미만이면 탈락시킨다',
    (strategy) => {
      expect(
        screenStocks(
          [candidate('000001', { turnover60: 499_999_999 })],
          strategy,
          20,
        ),
      ).toEqual([]);
    },
  );

  it.each(['LONG_TERM', 'SWING'] as const)(
    '%s는 60일 평균 거래대금을 확인할 수 없으면 탈락시킨다',
    (strategy) => {
      expect(
        screenStocks([candidate('000001', { turnover60: null })], strategy, 20),
      ).toEqual([]);
    },
  );

  it.each(['LONG_TERM', 'SWING'] as const)(
    '%s는 60일 평균 거래대금이 정확히 5억원이면 통과시킨다',
    (strategy) => {
      expect(
        screenStocks(
          [candidate('000001', { turnover60: 500_000_000 })],
          strategy,
          20,
        ),
      ).toEqual([expect.objectContaining({ code: '000001', score: 100 })]);
    },
  );

  it('후보 3개의 세 재료 순위 합을 100점, 50점, 0점으로 뒤집는다', () => {
    const result = screenStocks(
      [
        candidate('000003', {
          return6m: 10,
          volatility20: 30,
          high200Position: 0.7,
        }),
        candidate('000001', {
          return6m: 30,
          volatility20: 10,
          high200Position: 0.9,
        }),
        candidate('000002', {
          return6m: 20,
          volatility20: 20,
          high200Position: 0.8,
        }),
      ],
      'LONG_TERM',
      20,
    );

    expect(result.map(({ code, score }) => ({ code, score }))).toEqual([
      { code: '000001', score: 100 },
      { code: '000002', score: 50 },
      { code: '000003', score: 0 },
    ]);
  });

  it('통과 조건이 허용한 null 재료는 각 순위에서 맨 뒤로 보낸다', () => {
    const result = screenStocks(
      [
        candidate('000001', {
          return6m: null,
          volatility20: null,
          high200Position: null,
        }),
        candidate('000002', {
          return6m: 1,
          volatility20: 99,
          high200Position: 0.1,
        }),
      ],
      'LONG_TERM',
      20,
    );

    expect(result.map(({ code, score }) => ({ code, score }))).toEqual([
      { code: '000002', score: 100 },
      { code: '000001', score: 0 },
    ]);
  });

  it('장투는 정배열과 MA120 상향 돌파를 모두 요구한다', () => {
    const result = screenStocks(
      [
        candidate('000001'),
        candidate('000002', { isAligned: false }),
        candidate('000003', { ma120: null }),
        candidate('000004', { close: 100, ma120: 100 }),
      ],
      'LONG_TERM',
      20,
    );

    expect(result.map((stock) => stock.code)).toEqual(['000001']);
  });

  it('단타는 MA20 상향 돌파와 거래량 급증 1.5배를 요구하고 limit을 적용한다', () => {
    const result = screenStocks(
      [
        candidate('000003', { volumeSurge: 1.49 }),
        candidate('000002', { volumeSurge: 2, return1m: 5 }),
        candidate('000001', { volumeSurge: 3, return1m: 10 }),
        candidate('000004', { close: 120, ma20: 120 }),
      ],
      'SWING',
      1,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ code: '000001' }));
  });

  it('유동성 값이 달라도 랭킹 재료가 모두 동률이면 code 순으로 결정한다', () => {
    const result = screenStocks(
      [
        candidate('000003', { turnover60: 900_000_000 }),
        candidate('000001', { turnover60: 500_000_000 }),
        candidate('000002', { turnover60: 700_000_000 }),
      ],
      'LONG_TERM',
      20,
    );

    expect(result.map((stock) => stock.code)).toEqual([
      '000001',
      '000002',
      '000003',
    ]);
  });
});
