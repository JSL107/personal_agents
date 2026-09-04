import { StockIndicators } from '../../market-data/domain/stock-indicator';
import {
  DEFAULT_RANKING_WEIGHTS,
  MINIMUM_TURNOVER60,
  ScreenCandidate,
  SCREENER_RULE_VERSION,
  screenStocks,
  SWING_VOLUME_SURGE_MINIMUM,
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
  return1d: 0,
  return1m: 10,
  return3m: 20,
  return6m: 30,
  high200Position: 0.9,
  volatility20: 15,
  turnover60: LIQUID_TURNOVER60,
  highFallbackBarCount: 0,
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
    expect(SCREENER_RULE_VERSION).toBe(4);
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

describe('screenStocks 거래대금 하한 주입', () => {
  it('하한을 높이면 그 아래 종목이 탈락한다', () => {
    const candidates = [
      candidate('000001', { turnover60: 2e9 }),
      candidate('000002', { turnover60: 7e8 }),
    ];

    const withDefault = screenStocks(candidates, 'LONG_TERM', 10);
    const withRaised = screenStocks(candidates, 'LONG_TERM', 10, 1e9);

    expect(withDefault.map((stock) => stock.code)).toEqual([
      '000001',
      '000002',
    ]);
    expect(withRaised.map((stock) => stock.code)).toEqual(['000001']);
  });
});

describe('screenStocks — 당일 상승률 상한', () => {
  const swingCandidate = (
    code: string,
    overrides: Partial<StockIndicators> = {},
  ): ScreenCandidate =>
    candidate(code, { volumeSurge: 2, return1m: 10, ...overrides });

  // 기본값이 상한 없음이어야 이 변경이 운영 동작을 바꾸지 않는다.
  it('상한을 넘기지 않으면 급등 종목도 그대로 통과한다', () => {
    const screened = screenStocks(
      [swingCandidate('000001', { return1d: 25 })],
      'SWING',
      10,
    );

    expect(screened.map((stock) => stock.code)).toEqual(['000001']);
  });

  it('상한을 넘긴 종목은 후보에서 뺀다', () => {
    const screened = screenStocks(
      [
        swingCandidate('000001', { return1d: 25 }),
        swingCandidate('000002', { return1d: 5 }),
      ],
      'SWING',
      10,
      MINIMUM_TURNOVER60,
      15,
    );

    expect(screened.map((stock) => stock.code)).toEqual(['000002']);
  });

  // 경계는 포함이다. `<=` 가 `<` 로 바뀌면 정확히 상한에 붙은 종목이 빠진다.
  it('정확히 상한과 같으면 통과시킨다', () => {
    const screened = screenStocks(
      [swingCandidate('000001', { return1d: 15 })],
      'SWING',
      10,
      MINIMUM_TURNOVER60,
      15,
    );

    expect(screened.map((stock) => stock.code)).toEqual(['000001']);
  });

  // 지표 결측을 급등으로 취급하면 전일 봉이 없는 신규 상장이 통째로 빠진다.
  it('전일 종가가 없어 상승률을 모르는 종목은 빼지 않는다', () => {
    const screened = screenStocks(
      [swingCandidate('000001', { return1d: null })],
      'SWING',
      10,
      MINIMUM_TURNOVER60,
      15,
    );

    expect(screened.map((stock) => stock.code)).toEqual(['000001']);
  });

  // 상한은 매수 후보를 거르는 규칙이지 전략별 규칙이 아니다.
  it('LONG_TERM 후보에도 같은 상한이 걸린다', () => {
    const screened = screenStocks(
      [
        candidate('000001', { return1d: 25 }),
        candidate('000002', { return1d: 5 }),
      ],
      'LONG_TERM',
      10,
      MINIMUM_TURNOVER60,
      15,
    );

    expect(screened.map((stock) => stock.code)).toEqual(['000002']);
  });
});

describe('screenStocks — 측정 손잡이', () => {
  it('기본 가중치는 기존 1:1:1 순위합과 동일하다', () => {
    expect(DEFAULT_RANKING_WEIGHTS).toEqual([1, 1, 1]);
    expect(screenStocks([candidate('000001')], 'LONG_TERM', 10)).toEqual(
      screenStocks(
        [candidate('000001')],
        'LONG_TERM',
        10,
        MINIMUM_TURNOVER60,
        Number.POSITIVE_INFINITY,
        SWING_VOLUME_SURGE_MINIMUM,
        [1, 1, 1],
      ),
    );
  });

  it('거래량 재료를 제외한 가중 순위합을 계산한다', () => {
    const result = screenStocks(
      [
        candidate('000001', {
          volumeSurge: 3,
          return1m: 1,
          high200Position: 0.1,
        }),
        candidate('000002', {
          volumeSurge: 2,
          return1m: 10,
          high200Position: 0.2,
        }),
        candidate('000003', {
          volumeSurge: 1.6,
          return1m: 5,
          high200Position: 0.3,
        }),
      ],
      'SWING',
      10,
      MINIMUM_TURNOVER60,
      Number.POSITIVE_INFINITY,
      SWING_VOLUME_SURGE_MINIMUM,
      [0, 1, 1],
    );
    expect(result.map(({ code, score }) => ({ code, score }))).toEqual([
      { code: '000002', score: 75 },
      { code: '000003', score: 75 },
      { code: '000001', score: 0 },
    ]);
  });

  it('가중치 합을 정규화해 점수를 계산한다', () => {
    const result = screenStocks(
      [
        candidate('000001', {
          return6m: 30,
          volatility20: 10,
          high200Position: 0.7,
        }),
        candidate('000002', {
          return6m: 20,
          volatility20: 20,
          high200Position: 0.8,
        }),
        candidate('000003', {
          return6m: 10,
          volatility20: 30,
          high200Position: 0.9,
        }),
      ],
      'LONG_TERM',
      10,
      MINIMUM_TURNOVER60,
      Number.POSITIVE_INFINITY,
      SWING_VOLUME_SURGE_MINIMUM,
      [2, 1, 1],
    );
    expect(result.map(({ code, score }) => ({ code, score }))).toEqual([
      { code: '000001', score: 75 },
      { code: '000002', score: 50 },
      { code: '000003', score: 25 },
    ]);
  });

  it('유효하지 않은 가중치는 거부한다', () => {
    expect(() =>
      screenStocks(
        [],
        'SWING',
        10,
        MINIMUM_TURNOVER60,
        Number.POSITIVE_INFINITY,
        1.5,
        [-1, 1, 1],
      ),
    ).toThrow();
    expect(() =>
      screenStocks(
        [],
        'SWING',
        10,
        MINIMUM_TURNOVER60,
        Number.POSITIVE_INFINITY,
        1.5,
        [0, 0, 0],
      ),
    ).toThrow();
  });

  it('급증 임계를 높이면 SWING 후보를 거른다', () => {
    expect(
      screenStocks(
        [
          candidate('000001', { volumeSurge: 1.5 }),
          candidate('000002', { volumeSurge: 2 }),
        ],
        'SWING',
        10,
        MINIMUM_TURNOVER60,
        Number.POSITIVE_INFINITY,
        2,
      ).map((stock) => stock.code),
    ).toEqual(['000002']);
  });
});
