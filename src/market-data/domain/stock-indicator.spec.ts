import { DecimalValue } from './market-data.type';
import { calculateIndicators, IndicatorBar } from './stock-indicator';

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => String(value),
});

const barsFromCloses = (
  closes: number[],
  volumes: bigint[] = closes.map(() => 100n),
  rawCloses: number[] = closes,
): IndicatorBar[] =>
  closes.map((close, index) => ({
    tradeDate: new Date(Date.UTC(2025, 0, index + 1)),
    close: decimal(rawCloses[index]),
    adjClose: decimal(close),
    volume: volumes[index],
  }));

describe('calculateIndicators', () => {
  it('빈 봉은 계산 대상이 아니므로 null을 반환한다', () => {
    expect(calculateIndicators([])).toBeNull();
  });

  it.each([
    {
      count: 4,
      expected: {
        ma5: null,
        ma20: null,
        ma60: null,
        ma120: null,
        return1m: null,
        return3m: null,
        return6m: null,
        high200Position: null,
      },
    },
    {
      count: 20,
      expected: {
        ma5: 18,
        ma20: 10.5,
        ma60: null,
        ma120: null,
        return1m: null,
        return3m: null,
        return6m: null,
        high200Position: null,
      },
    },
    {
      count: 120,
      expected: {
        ma5: 118,
        ma20: 110.5,
        ma60: 90.5,
        ma120: 60.5,
        return1m: expect.closeTo(20, 10),
        return3m: 100,
        return6m: null,
        high200Position: null,
      },
    },
    {
      count: 200,
      expected: {
        ma5: 198,
        ma20: 190.5,
        ma60: 170.5,
        ma120: 140.5,
        return1m: expect.closeTo((200 / 180 - 1) * 100, 10),
        return3m: expect.closeTo((200 / 140 - 1) * 100, 10),
        return6m: expect.closeTo((200 / 80 - 1) * 100, 10),
        high200Position: 1,
      },
    },
  ])(
    '$count봉에서 필요한 기간을 채운 지표만 계산한다',
    ({ count, expected }) => {
      const indicators = calculateIndicators(
        barsFromCloses(Array.from({ length: count }, (_, index) => index + 1)),
      );

      expect(indicators).not.toBeNull();
      expect(indicators).toEqual(expect.objectContaining(expected));
      expect(indicators?.barCount).toBe(count);
    },
  );

  it.each([
    { count: 60, expected: null },
    { count: 199, expected: null },
    { count: 200, expected: 1 },
  ])(
    '$count봉일 때 high200Position은 200봉 계약을 지킨다',
    ({ count, expected }) => {
      const indicators = calculateIndicators(
        barsFromCloses(Array.from({ length: count }, (_, index) => index + 1)),
      );

      expect(indicators?.high200Position).toBe(expected);
    },
  );

  it('네 이동평균이 엄격한 내림차순일 때만 정배열이다', () => {
    const aligned = calculateIndicators(
      barsFromCloses(Array.from({ length: 120 }, (_, index) => index + 1)),
    );
    const flat = calculateIndicators(
      barsFromCloses(Array.from({ length: 120 }, () => 100)),
    );

    expect(aligned?.isAligned).toBe(true);
    expect(flat?.isAligned).toBe(false);
  });

  it('직전 20일 평균 거래량이 0이면 거래량 급증률은 null이다', () => {
    const indicators = calculateIndicators(
      barsFromCloses(
        Array.from({ length: 21 }, () => 100),
        [...Array.from({ length: 20 }, () => 0n), 300n],
      ),
    );

    expect(indicators?.volumeSurge).toBeNull();
  });

  it('59봉이면 60일 평균 거래대금을 계산하지 않는다', () => {
    const indicators = calculateIndicators(
      barsFromCloses(
        Array.from({ length: 59 }, () => 1),
        Array.from({ length: 59 }, () => 50_000n),
        Array.from({ length: 59 }, () => 10_000),
      ),
    );

    expect(indicators?.turnover60).toBeNull();
  });

  it('60봉이면 조정 종가가 아닌 원본 종가와 거래량으로 평균 거래대금을 계산한다', () => {
    const indicators = calculateIndicators(
      barsFromCloses(
        Array.from({ length: 60 }, () => 1),
        Array.from({ length: 60 }, () => 50_000n),
        Array.from({ length: 60 }, () => 10_000),
      ),
    );

    expect(indicators?.turnover60).toBe(500_000_000);
  });

  it('60봉을 초과하면 오래된 봉을 제외하고 최근 60봉 거래대금만 평균낸다', () => {
    const indicators = calculateIndicators(
      barsFromCloses(
        Array.from({ length: 61 }, () => 1),
        Array.from({ length: 61 }, () => 50_000n),
        [1_000_000, ...Array.from({ length: 60 }, () => 10_000)],
      ),
    );

    expect(indicators?.turnover60).toBe(500_000_000);
  });

  it('고정 1% 일간 상승 입력에서 수익률·거래량 급증·변동성을 계산한다', () => {
    const closes = Array.from(
      { length: 21 },
      (_, index) => 100 * 1.01 ** index,
    );
    const indicators = calculateIndicators(
      barsFromCloses(closes, [...Array.from({ length: 20 }, () => 100n), 300n]),
    );

    expect(indicators?.close).toBeCloseTo(100 * 1.01 ** 20, 10);
    expect(indicators?.return1m).toBeCloseTo((1.01 ** 20 - 1) * 100, 10);
    expect(indicators?.volumeSurge).toBe(3);
    expect(indicators?.volatility20).toBeCloseTo(0, 10);
  });

  it('201봉 입력에서도 high200은 마지막 200봉의 최고가만 사용한다', () => {
    const indicators = calculateIndicators(
      barsFromCloses([1_000, ...Array.from({ length: 200 }, () => 100)]),
    );

    expect(indicators?.high200Position).toBe(1);
  });

  it('20개 일간 수익률의 표본표준편차는 n-1 분모로 계산한다', () => {
    const indicators = calculateIndicators(
      barsFromCloses([...Array.from({ length: 20 }, () => 100), 110]),
    );

    expect(indicators?.volatility20).toBeCloseTo(35.4964786985977, 10);
  });
});
