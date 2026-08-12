import { DailySeriesPoint } from '../../market-data/domain/market-data.type';
import { calculateIndicator, MINIMUM_BAR_COUNT } from './indicator';

// 기본은 조정가와 원본 종가가 같다. 분할 이력을 재현할 때만 closes 를 따로 준다.
const buildBars = (
  adjCloses: number[],
  volumes?: number[],
  closes?: number[],
): DailySeriesPoint[] =>
  adjCloses.map((adjClose, index) => ({
    tradeDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    close: closes?.[index] ?? adjClose,
    adjClose,
    volume: volumes?.[index] ?? 1_000,
  }));

describe('calculateIndicator', () => {
  it('봉이 최소 개수보다 적으면 null을 돌려준다', () => {
    const bars = buildBars(
      Array.from({ length: MINIMUM_BAR_COUNT - 1 }, () => 100),
    );

    expect(calculateIndicator(bars)).toBeNull();
  });

  it('조정가가 0 이하인 봉이 섞이면 null을 돌려준다', () => {
    const adjCloses = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    adjCloses[10] = 0;

    expect(calculateIndicator(buildBars(adjCloses))).toBeNull();
  });

  it('지표는 조정가로 계산하고 거래대금과 표시 종가는 원본 종가로 둔다', () => {
    // 분할 이력이 있는 종목: 조정가는 100 으로 평평하고 원본 종가는 200 이다.
    const adjCloses = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 200);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 3_000);
    const indicator = calculateIndicator(buildBars(adjCloses, volumes, closes));

    // 조정가가 평평하므로 추세 지표는 왜곡이 없다.
    expect(indicator!.ma20).toBe(100);
    expect(indicator!.return120).toBeCloseTo(0, 10);
    expect(indicator!.disparity20).toBeCloseTo(1, 10);
    expect(indicator!.high200Position).toBeCloseTo(1, 10);
    // 거래대금은 실제 체결가 200 × 3,000
    expect(indicator!.turnover60).toBe(600_000);
    // 사람이 보는 값은 원본 종가
    expect(indicator!.lastClose).toBe(200);
  });

  it('이동평균과 정배열·추세를 계산한다', () => {
    // 1부터 121까지 단조 증가 — 최근값이 가장 크므로 모든 이동평균이 정배열이 된다.
    const closes = Array.from(
      { length: MINIMUM_BAR_COUNT },
      (_, index) => index + 1,
    );
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator).not.toBeNull();
    // 마지막 5봉은 117~121, 평균 119
    expect(indicator!.ma5).toBe(119);
    // 마지막 20봉은 102~121, 평균 111.5
    expect(indicator!.ma20).toBe(111.5);
    expect(indicator!.isAligned).toBe(true);
    expect(indicator!.isUptrend).toBe(true);
    expect(indicator!.lastClose).toBe(121);
    expect(indicator!.barCount).toBe(MINIMUM_BAR_COUNT);
  });

  it('하락 추세에서는 정배열과 중장기 상승이 모두 거짓이다', () => {
    const closes = Array.from(
      { length: MINIMUM_BAR_COUNT },
      (_, index) => MINIMUM_BAR_COUNT - index,
    );
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator!.isAligned).toBe(false);
    expect(indicator!.isUptrend).toBe(false);
  });

  it('기간 수익률을 계산한다', () => {
    // 121봉 전부 100이고 마지막만 120 → 20·60·120거래일 전 대비 모두 +20%
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    closes[closes.length - 1] = 120;
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator!.return20).toBeCloseTo(0.2, 10);
    expect(indicator!.return60).toBeCloseTo(0.2, 10);
    expect(indicator!.return120).toBeCloseTo(0.2, 10);
  });

  it('거래량 급증 배수는 최근 5일 평균을 60일 평균으로 나눈 값이다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, (_, index) =>
      index >= MINIMUM_BAR_COUNT - 5 ? 1_100 : 100,
    );
    const indicator = calculateIndicator(buildBars(closes, volumes));

    // 최근 5일 평균 1,100 ÷ 최근 60일 평균 ((55×100 + 5×1,100) ÷ 60)
    expect(indicator!.volumeSurge).toBeCloseTo(
      1_100 / ((55 * 100 + 5 * 1_100) / 60),
      10,
    );
  });

  it('60일 평균 거래량이 0이면 급증 배수를 0으로 둔다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 0);
    const indicator = calculateIndicator(buildBars(closes, volumes));

    expect(indicator!.volumeSurge).toBe(0);
  });

  it('200일 고가 대비 위치와 20일 이격도를 계산한다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    closes[0] = 200;
    const indicator = calculateIndicator(buildBars(closes));

    // 최고 종가 200, 현재가 100
    expect(indicator!.high200Position).toBeCloseTo(0.5, 10);
    // 최근 20봉이 모두 100이라 20일선도 100
    expect(indicator!.disparity20).toBeCloseTo(1, 10);
  });

  it('종가가 일정하면 변동성은 0이다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator!.volatility20).toBeCloseTo(0, 10);
  });

  it('60일 평균 거래대금은 종가 × 거래량의 평균이다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 3_000);
    const indicator = calculateIndicator(buildBars(closes, volumes));

    expect(indicator!.turnover60).toBe(300_000);
  });

  it('마지막 봉의 거래일을 그대로 싣는다', () => {
    const bars = buildBars(
      Array.from({ length: MINIMUM_BAR_COUNT }, () => 100),
    );
    const indicator = calculateIndicator(bars);

    expect(indicator!.lastTradeDate).toBe(bars[bars.length - 1].tradeDate);
  });
});
