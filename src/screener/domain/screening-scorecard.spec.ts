import {
  buildScorecardHorizon,
  ScreeningScorecardRow,
} from './screening-scorecard';

const row = (
  overrides: Partial<ScreeningScorecardRow> = {},
): ScreeningScorecardRow => ({
  strategy: 'SWING',
  ruleVersion: 2,
  runId: 1,
  rank: 1,
  presented: true,
  returnPct: 0,
  bought: false,
  tickerCode: '000000',
  tickerName: '테스트',
  ...overrides,
});

describe('buildScorecardHorizon', () => {
  it('산 것과 안 산 것을 갈라 세고 격차를 평균 차이로 낸다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 4,
      pendingRunCount: 3,
      rows: [
        row({ bought: true, returnPct: 10, rank: 1 }),
        row({ bought: true, returnPct: 2, rank: 3 }),
        row({ bought: false, returnPct: 4, rank: 2 }),
        row({ bought: false, returnPct: -2, rank: 4 }),
      ],
    });

    const [strategy] = horizon.strategies;
    expect(horizon.sampleCount).toBe(4);
    expect(horizon.newlyScoredCount).toBe(4);
    expect(horizon.pendingRunCount).toBe(3);
    expect(strategy.bought.count).toBe(2);
    expect(strategy.bought.meanReturnPct).toBe(6);
    expect(strategy.notBought.count).toBe(2);
    expect(strategy.notBought.meanReturnPct).toBe(1);
    expect(strategy.gapPct).toBe(5);
    expect(strategy.boughtMeanRank).toBe(2);
  });

  it('이익 건수는 0 초과만 센다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ bought: true, returnPct: 0 }),
        row({ bought: true, returnPct: 0.01 }),
        row({ bought: true, returnPct: -0.01 }),
      ],
    });

    expect(horizon.strategies[0].bought.winCount).toBe(1);
  });

  it('중앙값은 짝수 표본에서 가운데 두 값의 평균이다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ returnPct: 1 }),
        row({ returnPct: 3 }),
        row({ returnPct: 5 }),
        row({ returnPct: 11 }),
      ],
    });

    expect(horizon.strategies[0].notBought.medianReturnPct).toBe(4);
  });

  // 한쪽이 비면 0 이 아니라 null 이어야 한다. 0 으로 두면 "차이가 없었다" 로 읽혀,
  // 비교할 대조군이 없었다는 사실이 사라진다.
  it('한쪽에 표본이 없으면 격차를 내지 않는다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [row({ bought: true, returnPct: 7 })],
    });

    const [strategy] = horizon.strategies;
    expect(strategy.notBought.count).toBe(0);
    expect(strategy.notBought.meanReturnPct).toBeNull();
    expect(strategy.gapPct).toBeNull();
  });

  it('순위 축은 상위 5위까지만 모집단으로 삼는다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ rank: 1, returnPct: 10 }),
        row({ rank: 5, returnPct: 20 }),
        row({ rank: 6, returnPct: 1000 }),
      ],
    });

    const [strategy] = horizon.strategies;
    expect(strategy.topRankCount).toBe(2);
    expect(strategy.topRankMeanReturnPct).toBe(15);
  });

  it('전략별로 갈라 세고 규칙 버전이 섞이면 둘 다 남긴다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ strategy: 'SWING', ruleVersion: 3 }),
        row({ strategy: 'SWING', ruleVersion: 2 }),
        row({ strategy: 'LONG_TERM', ruleVersion: 2 }),
      ],
    });

    expect(horizon.strategies.map((strategy) => strategy.strategy)).toEqual([
      'LONG_TERM',
      'SWING',
    ]);
    expect(horizon.strategies[1].ruleVersions).toEqual([2, 3]);
  });

  it('극단 사례는 안 산 것 중 최고와 산 것 중 최악을 집는다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ bought: false, returnPct: 33.5, tickerCode: '001210' }),
        row({ bought: false, returnPct: 1 }),
        row({ bought: true, returnPct: -11.45, tickerCode: '085620' }),
        row({ bought: true, returnPct: 5 }),
      ],
    });

    const [strategy] = horizon.strategies;
    expect(strategy.bestMissed?.tickerCode).toBe('001210');
    expect(strategy.worstBought?.tickerCode).toBe('085620');
  });

  it('상한 밖 종목은 안 산 것 대조군에 섞이지 않는다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ presented: true, bought: true, returnPct: 10, rank: 1 }),
        row({ presented: true, bought: false, returnPct: 4, rank: 2 }),
        // 모델이 본 적 없는 종목. 여기 성적이 대조군에 들어가면 격차가 선택이 아니라
        // 순위 상한을 재게 된다.
        row({ presented: false, bought: false, returnPct: -20, rank: 21 }),
        row({ presented: false, bought: false, returnPct: -40, rank: 22 }),
      ],
    });

    const [strategy] = horizon.strategies;
    expect(horizon.sampleCount).toBe(4);
    expect(strategy.notBought.count).toBe(1);
    expect(strategy.notBought.meanReturnPct).toBe(4);
    expect(strategy.gapPct).toBe(6);
    expect(strategy.notPresented.count).toBe(2);
    expect(strategy.notPresented.meanReturnPct).toBe(-30);
    // 회차가 하나뿐이라 그 회차의 격차가 곧 값이다. 보여준 것 평균(7) − 상한 밖 평균(-30).
    expect(strategy.cutoffGapPct).toBe(37);
    expect(strategy.cutoffRunCount).toBe(1);
  });

  // 통째로 모아 평균 차를 내면 회차마다 다른 종목 수가 날짜별 가중치를 흔들어, 순위 절단이
  // 아니라 장세를 재게 된다.
  it('절단 격차는 회차 안에서 재고 그 평균을 낸다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        // 상승한 날 — 상한 밖이 1종목.
        row({ runId: 1, presented: true, returnPct: 10 }),
        row({ runId: 1, presented: false, returnPct: 9 }),
        // 하락한 날 — 상한 밖이 3종목이라 통째로 모으면 이쪽 장세가 더 무겁게 실린다.
        row({ runId: 2, presented: true, returnPct: -10 }),
        row({ runId: 2, presented: false, returnPct: -11 }),
        row({ runId: 2, presented: false, returnPct: -11 }),
        row({ runId: 2, presented: false, returnPct: -11 }),
      ],
    });

    // 회차별 격차는 두 날 모두 +1 이다. 누적 평균 차로 내면 0 − (−6) = +6 이 되어,
    // 절단 효과가 실제의 여섯 배로 부풀려진다.
    expect(horizon.strategies[0].cutoffGapPct).toBe(1);
    expect(horizon.strategies[0].cutoffRunCount).toBe(2);
  });

  // 통과 전체 저장 이전 회차는 상한 밖 행이 아예 없다. 성적 조회에 기간 상한이 없어 그
  // 회차들이 영구히 표본에 남으므로, 통째로 모으면 그날 장세가 보여준 것 쪽에만 걸린다.
  it('상한 밖이 없는 옛 회차는 절단 격차에 끼어들지 않는다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        // 컬럼이 생기기 전 회차 — 보여준 것만 있다.
        row({ runId: 1, presented: true, returnPct: 10 }),
        row({ runId: 2, presented: true, returnPct: -10 }),
        row({ runId: 2, presented: false, returnPct: -12 }),
      ],
    });

    // 회차 2 만 격차를 만든다(+2). 옛 회차를 섞으면 0 − (−12) = +12 로 여섯 배가 된다.
    expect(horizon.strategies[0].cutoffGapPct).toBe(2);
    expect(horizon.strategies[0].cutoffRunCount).toBe(1);
    // 갈래 자체에는 옛 회차도 그대로 센다 — 빼면 "상한 밖 평균" 이 아니라 격차 계산용
    // 부분집합이 되어 두 수가 서로 다른 것을 말하게 된다.
    expect(horizon.strategies[0].notPresented.count).toBe(1);
  });

  it('놓친 최고와 상위 순위 축도 보여준 것 안에서만 센다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [
        row({ presented: true, bought: true, returnPct: 1, rank: 1 }),
        row({ presented: true, bought: false, returnPct: 2, rank: 2 }),
        // 순위는 상위 구간 밖이지만, 상한 밖 종목은 순위와 무관하게 두 축에서 빠진다.
        row({
          presented: false,
          bought: false,
          returnPct: 99,
          rank: 3,
          tickerCode: '999999',
        }),
      ],
    });

    const [strategy] = horizon.strategies;
    expect(strategy.topRankCount).toBe(2);
    expect(strategy.topRankMeanReturnPct).toBe(1.5);
    expect(strategy.bestMissed?.returnPct).toBe(2);
  });

  it('상한 밖 표본이 없으면 절단 격차를 내지 않는다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 5,
      newlyScoredCount: 0,
      pendingRunCount: 0,
      rows: [row({ presented: true, bought: true, returnPct: 3 })],
    });

    // 0 으로 두면 "상한이 아무 차이도 안 냈다" 로 읽혀, 비교 대상이 없었다는 사실이 사라진다.
    expect(horizon.strategies[0].notPresented.count).toBe(0);
    expect(horizon.strategies[0].cutoffGapPct).toBeNull();
    expect(horizon.strategies[0].cutoffRunCount).toBe(0);
  });

  it('표본이 없으면 전략 목록이 비고 표본 수가 0 이다', () => {
    const horizon = buildScorecardHorizon({
      horizonDays: 20,
      newlyScoredCount: 0,
      pendingRunCount: 14,
      rows: [],
    });

    expect(horizon.sampleCount).toBe(0);
    expect(horizon.strategies).toEqual([]);
    expect(horizon.pendingRunCount).toBe(14);
  });
});
