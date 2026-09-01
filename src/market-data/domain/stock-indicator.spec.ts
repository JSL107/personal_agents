import { DecimalValue } from './market-data.type';
import { calculateIndicators, IndicatorBar } from './stock-indicator';

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => String(value),
});

// 고가·저가를 따로 주지 않으면 진폭이 0 인 봉(고가=저가=조정 종가)으로 만든다. 그러면
// 최고가 기준 `high200Position` 이 옛 최고 종가 기준과 같은 값을 내므로, 기존 기대값이
// 그대로 회귀 감시 역할을 한다.
const barsFromCloses = (
  closes: number[],
  volumes: bigint[] = closes.map(() => 100n),
  rawCloses: number[] = closes,
  highs?: (number | null)[],
): IndicatorBar[] =>
  closes.map((close, index) => {
    const high = highs === undefined ? close : highs[index];
    return {
      tradeDate: new Date(Date.UTC(2025, 0, index + 1)),
      close: decimal(rawCloses[index]),
      adjClose: decimal(close),
      high: high === null ? null : decimal(high),
      low: high === null ? null : decimal(close),
      volume: volumes[index],
    };
  });

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

  // 이 변경의 핵심이다. 장중에 120 까지 찍고 100 으로 내려온 날이 있으면 신고가는 120 이고
  // 오늘 종가 100 은 그 아래다. 종가만 보던 옛 기준은 이 날을 100 으로 읽어 "신고가에 있다"
  // (=1) 는 잘못된 값을 냈다.
  it('장중에 찍고 내려온 고점을 신고가로 센다', () => {
    const closes = Array.from({ length: 200 }, () => 100);
    const highs: (number | null)[] = closes.map(() => 100);
    highs[50] = 120;

    const indicators = calculateIndicators(
      barsFromCloses(closes, undefined, undefined, highs),
    );

    expect(indicators?.high200Position).toBeCloseTo(100 / 120, 10);
  });

  // 5년 재적재 밖 구간과 공급자가 봉을 주지 않는 소수 종목에는 고가가 없다. 그 봉을 통째로
  // 빼면 200봉 계약이 깨지므로 조정 종가로 대신한다 — 종가는 고가 이하라 최대값을 낮출
  // 뿐이고, 없는 신고가를 지어내지 않는다.
  it('고가가 없는 봉은 그 봉의 조정 종가로 대신한다', () => {
    const closes = [...Array.from({ length: 199 }, () => 100), 90];
    const highs: (number | null)[] = closes.map(() => null);

    const indicators = calculateIndicators(
      barsFromCloses(closes, undefined, undefined, highs),
    );

    expect(indicators?.high200Position).toBeCloseTo(90 / 100, 10);
  });

  // 계수 없이는 성적을 읽을 때 어느 종목이 종가 대체 이득을 봤는지 알 수 없다.
  it('고가가 없어 종가로 대신한 봉 수를 센다', () => {
    const closes = Array.from({ length: 200 }, () => 100);
    const highs: (number | null)[] = closes.map((_, index) =>
      index < 3 ? null : 100,
    );

    const indicators = calculateIndicators(
      barsFromCloses(closes, undefined, undefined, highs),
    );

    expect(indicators?.highFallbackBarCount).toBe(3);
  });

  // 200봉 계약과 같은 창을 본다. 창 밖의 결측을 세면 "지금 순위에 섞인 양" 이 아니게 된다.
  it('200봉 창 밖의 고가 결측은 세지 않는다', () => {
    const closes = Array.from({ length: 201 }, () => 100);
    const highs: (number | null)[] = closes.map((_, index) =>
      index === 0 ? null : 100,
    );

    const indicators = calculateIndicators(
      barsFromCloses(closes, undefined, undefined, highs),
    );

    expect(indicators?.highFallbackBarCount).toBe(0);
  });

  it('20개 일간 수익률의 표본표준편차는 n-1 분모로 계산한다', () => {
    const indicators = calculateIndicators(
      barsFromCloses([...Array.from({ length: 20 }, () => 100), 110]),
    );

    expect(indicators?.volatility20).toBeCloseTo(35.4964786985977, 10);
  });
});
