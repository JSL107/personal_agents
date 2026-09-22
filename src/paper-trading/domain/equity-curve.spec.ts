import { buildEquityCurveChart, lastValueOf } from './equity-curve';

const dateOf = (text: string): Date => new Date(`${text}T00:00:00.000Z`);

const accountSeries = (
  accountName: string,
  points: Array<[string, number]>,
): {
  accountName: string;
  points: Array<{ tradeDate: Date; returnRatePercent: number }>;
} => ({
  accountName,
  points: points.map(([tradeDate, returnRatePercent]) => ({
    tradeDate: dateOf(tradeDate),
    returnRatePercent,
  })),
});

const benchmarkPoints = (
  points: Array<[string, number]>,
): Array<{ tradeDate: Date; close: number }> =>
  points.map(([tradeDate, close]) => ({ tradeDate: dateOf(tradeDate), close }));

describe('buildEquityCurveChart', () => {
  it('지수를 계좌 첫 거래일 기준 변화율로 바꿔 같은 축에 놓는다', () => {
    const chart = buildEquityCurveChart({
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-14', 0],
          ['2026-08-15', 2],
        ]),
      ],
      benchmark: benchmarkPoints([
        ['2026-08-14', 2000],
        ['2026-08-15', 2100],
      ]),
      benchmarkLabel: 'KOSPI',
    });

    const benchmark = chart.lines.find((line) => line.kind === 'BENCHMARK');
    expect(benchmark).toBeDefined();
    // 기준일은 0%, 다음 날은 2100/2000 - 1 = +5%.
    // 값 비교에 toBeCloseTo 를 쓰는 이유는 나눗셈의 부동소수점 오차다(5.000000000000004).
    // 좌표 계산과 `toFixed(1)` 라벨에는 영향이 없어 구현에서 반올림하지 않는다.
    expect(benchmark?.points.map((point) => point.tradeDate)).toEqual([
      '2026-08-14',
      '2026-08-15',
    ]);
    expect(benchmark?.points[0].valuePercent).toBeCloseTo(0, 6);
    expect(benchmark?.points[1].valuePercent).toBeCloseTo(5, 6);
    expect(chart.benchmarkOmittedReason).toBeNull();
  });

  // 계좌 스냅샷은 평가 cron 이 도는 날에만 쌓이고 지수는 거래일에만 쌓여, 두 날짜 집합이
  // 어긋날 수 있다. 기준일 당일 종가가 없다고 지수를 통째로 버리면 비교가 사라진다.
  it('기준일 당일 지수 종가가 없으면 직전 종가를 기준으로 쓴다', () => {
    const chart = buildEquityCurveChart({
      // 계좌 곡선은 08-14 에 시작하는데 지수에는 그날 값이 없다.
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-14', 0],
          ['2026-08-16', 1],
        ]),
      ],
      benchmark: benchmarkPoints([
        ['2026-08-13', 2000],
        ['2026-08-16', 2200],
      ]),
      benchmarkLabel: 'KOSPI',
    });

    const benchmark = chart.lines.find((line) => line.kind === 'BENCHMARK');
    // 08-13 종가 2000 이 기준이므로 08-13 은 0%, 08-16 은 +10%.
    expect(benchmark?.points.map((point) => point.tradeDate)).toEqual([
      '2026-08-13',
      '2026-08-16',
    ]);
    expect(benchmark?.points[1].valuePercent).toBeCloseTo(10, 6);
  });

  // 기준이 없는데 아무 종가로 정규화하면 선이 위아래 아무 데나 놓인다. 그린 것보다
  // 안 그린 것이 정직하고, 왜 없는지는 읽는 사람에게 적어 줘야 한다.
  it('기준일 이전 지수 종가가 없으면 지수 선을 그리지 않고 사유를 남긴다', () => {
    const chart = buildEquityCurveChart({
      series: [accountSeries('LONG_TERM', [['2026-08-14', 0]])],
      benchmark: benchmarkPoints([['2026-08-20', 2000]]),
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.lines.every((line) => line.kind === 'ACCOUNT')).toBe(true);
    expect(chart.benchmarkOmittedReason).toContain('2026-08-14');
  });

  it('지수 종가가 0건이면 사유를 남기고 계좌 곡선만 그린다', () => {
    const chart = buildEquityCurveChart({
      series: [accountSeries('SWING', [['2026-08-14', -3]])],
      benchmark: [],
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.lines).toHaveLength(1);
    expect(chart.benchmarkOmittedReason).toBe('지수 종가가 조회되지 않았다');
  });

  // 지수는 계좌 평가가 멈춘 뒤에도 쌓인다. 그 구간까지 그리면 지수 선만 오른쪽으로 더
  // 뻗어, 같은 기간을 비교한 그림이 아니게 된다.
  it('지수 선을 계좌 곡선의 마지막 날까지만 그린다', () => {
    const chart = buildEquityCurveChart({
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-14', 0],
          ['2026-08-15', 1],
        ]),
      ],
      benchmark: benchmarkPoints([
        ['2026-08-14', 2000],
        ['2026-08-15', 2100],
        ['2026-08-16', 2500],
      ]),
      benchmarkLabel: 'KOSPI',
    });

    const benchmark = chart.lines.find((line) => line.kind === 'BENCHMARK');
    expect(benchmark?.points.map((point) => point.tradeDate)).toEqual([
      '2026-08-14',
      '2026-08-15',
    ]);
    expect(chart.lastTradeDate).toBe('2026-08-15');
  });

  it('계좌 스냅샷이 없으면 빈 차트와 사유를 낸다', () => {
    const chart = buildEquityCurveChart({
      series: [accountSeries('LONG_TERM', [])],
      benchmark: benchmarkPoints([['2026-08-14', 2000]]),
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.lines).toEqual([]);
    expect(chart.firstTradeDate).toBeNull();
    expect(chart.benchmarkOmittedReason).toBe('계좌 평가 스냅샷이 없다');
  });

  // 개설 직후에는 수익률이 0 부근에 몰려 있다. 범위 비례 여백만 두면 축 폭이 0 에 가까워져
  // 선이 납작하게 눌린다.
  it('값의 폭이 좁아도 축 범위에 하한 여백을 둔다', () => {
    const chart = buildEquityCurveChart({
      series: [accountSeries('LONG_TERM', [['2026-08-14', 0.1]])],
      benchmark: [],
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.maxPercent - chart.minPercent).toBeGreaterThanOrEqual(4);
  });

  it('유한하지 않은 수익률 값은 곡선에서 뺀다', () => {
    const chart = buildEquityCurveChart({
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-14', 0],
          ['2026-08-15', Number.NaN],
          ['2026-08-16', 3],
        ]),
      ],
      benchmark: [],
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.lines[0].points.map((point) => point.tradeDate)).toEqual([
      '2026-08-14',
      '2026-08-16',
    ]);
  });

  it('날짜가 뒤섞여 들어와도 시간순으로 정렬한다', () => {
    const chart = buildEquityCurveChart({
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-16', 3],
          ['2026-08-14', 0],
        ]),
      ],
      benchmark: [],
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.firstTradeDate).toBe('2026-08-14');
    // 재정규화가 나눗셈이라 부동소수점 오차가 남는다(3.0000000000000027).
    expect(lastValueOf(chart.lines[0])).toBeCloseTo(3, 6);
  });

  // 계좌 수익률은 시드 대비 누적이라 차트 첫 점이 0% 가 아니다. 그대로 그리면 0% 에서
  // 출발하는 지수 선과 출발점이 어긋나, 두 선의 간격이 이 기간의 성적 차이가 아니게 된다.
  it('계좌 곡선을 기준일 0% 로 되맞춰 지수와 출발점을 맞춘다', () => {
    const chart = buildEquityCurveChart({
      series: [
        // 기준일에 이미 +10% 인 계좌. 이후 +21% 까지 올랐으므로 기간 수익률은
        // 1.21/1.10 - 1 = +10% 다(차로 계산하면 +11%p 로 어긋난다).
        accountSeries('LONG_TERM', [
          ['2026-08-14', 10],
          ['2026-08-15', 21],
        ]),
      ],
      benchmark: benchmarkPoints([
        ['2026-08-14', 2000],
        ['2026-08-15', 2100],
      ]),
      benchmarkLabel: 'KOSPI',
    });

    const account = chart.lines.find((line) => line.kind === 'ACCOUNT');
    const benchmark = chart.lines.find((line) => line.kind === 'BENCHMARK');
    expect(account?.points[0].valuePercent).toBeCloseTo(0, 6);
    expect(account?.points[1].valuePercent).toBeCloseTo(10, 6);
    // 두 선이 같은 날 0% 에서 출발한다 — 그래야 간격이 성적 차이만 담는다.
    expect(benchmark?.points[0].valuePercent).toBeCloseTo(0, 6);
    expect(benchmark?.points[1].valuePercent).toBeCloseTo(5, 6);
  });

  // 지수 선은 하나뿐이라 시작일이 다른 두 계좌에 동시에 맞출 수 없다. 공통 시작일로
  // 맞추고, 잘린 계좌가 있다는 사실을 결과에 남긴다.
  it('계좌 시작일이 다르면 공통 시작일로 맞추고 잘린 계좌를 알린다', () => {
    const chart = buildEquityCurveChart({
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-14', 5],
          ['2026-08-20', 8],
        ]),
        accountSeries('SWING', [['2026-08-20', -3]]),
      ],
      benchmark: benchmarkPoints([
        ['2026-08-14', 2000],
        ['2026-08-20', 2200],
      ]),
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.firstTradeDate).toBe('2026-08-20');
    expect(chart.truncatedAccounts).toEqual(['LONG_TERM']);
    // 모든 선이 08-20 한 점만 남아 0% 에서 출발한다.
    for (const line of chart.lines) {
      expect(line.points[0].tradeDate).toBe('2026-08-20');
      expect(line.points[0].valuePercent).toBeCloseTo(0, 6);
    }
  });

  // 기준 시점에 시드를 전부 잃은 계좌는 배수가 0 이라 나눌 수 없다. Infinity 로 그리면
  // 축이 통째로 무너져 나머지 곡선까지 못 읽게 된다.
  it('기준일 수익률이 -100% 인 계좌는 곡선에서 뺀다', () => {
    const chart = buildEquityCurveChart({
      series: [
        accountSeries('LONG_TERM', [
          ['2026-08-14', -100],
          ['2026-08-15', -100],
        ]),
        accountSeries('SWING', [
          ['2026-08-14', 2],
          ['2026-08-15', 4],
        ]),
      ],
      benchmark: [],
      benchmarkLabel: 'KOSPI',
    });

    expect(chart.lines.map((line) => line.label)).toEqual(['SWING']);
    expect(
      chart.lines.every((line) =>
        line.points.every((point) => Number.isFinite(point.valuePercent)),
      ),
    ).toBe(true);
  });
});
