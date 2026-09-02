import {
  addMonths,
  buildParameterGrid,
  buildSearchWindows,
  ConditionOutcomes,
  evaluateRobustWalkForward,
  evaluateWalkForward,
  formatCombinationLabel,
  ParameterCombination,
  rankWithinWindow,
  summarizeAcrossConditions,
  summarizeCombinations,
  WindowOutcome,
} from './parameter-search';

const BASELINE: ParameterCombination = {
  takeProfitPercent: 10,
  stopLossPercent: -5,
  minimumTurnover60: 5e8,
  maximumWeightPercent: 20,
};

const outcomeOf = (
  windowIndex: number,
  label: string,
  excessReturnPercent: number | null,
): WindowOutcome => ({
  windowIndex,
  label,
  excessReturnPercent,
  finalReturnPercent: excessReturnPercent,
  maximumLossPercent: -10,
  hitRatePercent: 50,
  closedCount: 10,
  filledCount: 20,
});

describe('addMonths', () => {
  it('말일에 개월을 더해도 없는 날짜로 넘어가지 않는다', () => {
    // setUTCMonth 에 그냥 맡기면 1/31 + 1개월이 3/3 이 된다. 창 경계가 한 달씩 밀린다.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('달을 넘겨도 해가 함께 넘어간다', () => {
    expect(addMonths('2021-10-01', 6)).toBe('2022-04-01');
  });

  it('없는 날짜는 받지 않는다', () => {
    expect(() => addMonths('2026-02-30', 1)).toThrow('실제 존재하는 날짜');
  });
});

describe('buildSearchWindows', () => {
  it('6개월 비중첩이면 측정 구간을 10개 창으로 자른다', () => {
    const windows = buildSearchWindows({
      from: '2021-10-01',
      to: '2026-08-31',
      windowMonths: 6,
      stepMonths: 6,
    });

    expect(windows).toHaveLength(10);
    expect(windows[0]).toEqual({
      index: 1,
      from: '2021-10-01',
      to: '2022-03-31',
    });
    // 마지막 창은 to 에서 잘린 5개월이다. 창 크기의 절반을 넘으므로 버리지 않는다.
    expect(windows[9]).toEqual({
      index: 10,
      from: '2026-04-01',
      to: '2026-08-31',
    });
  });

  it('이동 폭을 줄이면 창이 겹치며 늘어난다', () => {
    const windows = buildSearchWindows({
      from: '2021-10-01',
      to: '2022-09-30',
      windowMonths: 6,
      stepMonths: 3,
    });

    expect(windows.map((window) => window.from)).toEqual([
      '2021-10-01',
      '2022-01-01',
      '2022-04-01',
      // 꼬리 3개월은 창 크기의 절반이라 살아남는다 — 절반 미만부터 버린다.
      '2022-07-01',
    ]);
  });

  it('창 크기의 절반도 안 남은 꼬리는 버린다', () => {
    // 표본이 반토막인 창을 다른 창과 같은 한 표로 세면 순위 종합이 그 창에 흔들린다.
    const windows = buildSearchWindows({
      from: '2021-10-01',
      to: '2022-05-31',
      windowMonths: 6,
      stepMonths: 6,
    });

    expect(windows).toHaveLength(1);
  });

  it('from 이 to 보다 늦으면 조용히 빈 목록을 주지 않는다', () => {
    expect(() =>
      buildSearchWindows({
        from: '2026-01-01',
        to: '2025-01-01',
        windowMonths: 6,
        stepMonths: 6,
      }),
    ).toThrow('--from 이 --to 보다 늦습니다');
  });
});

describe('buildParameterGrid', () => {
  it('축들의 전수 조합을 만든다', () => {
    const grid = buildParameterGrid({
      takeProfitPercents: [5, 10],
      stopLossPercents: [-3, -5],
      minimumTurnover60s: [3e8],
      maximumWeightPercents: [20],
      includeBandless: false,
      baseline: BASELINE,
    });

    // 밴드 2x2 에 격자 밖 현행값(거래대금 5억)이 하나 더 붙는다.
    expect(grid).toHaveLength(5);
    expect(grid.slice(1).map(formatCombinationLabel)).toEqual([
      '+5/-3 · 3억 · 20%',
      '+5/-5 · 3억 · 20%',
      '+10/-3 · 3억 · 20%',
      '+10/-5 · 3억 · 20%',
    ]);
  });

  it('격자에 없는 현행값도 반드시 넣는다', () => {
    // 없으면 비교 기준이 사라져 walk-forward 판정 자체가 성립하지 않는다.
    const grid = buildParameterGrid({
      takeProfitPercents: [5],
      stopLossPercents: [-3],
      minimumTurnover60s: [3e8],
      maximumWeightPercents: [20],
      includeBandless: false,
      baseline: BASELINE,
    });

    expect(grid.map(formatCombinationLabel)).toEqual([
      '+10/-5 · 5억 · 20%',
      '+5/-3 · 3억 · 20%',
    ]);
  });

  it('현행값이 격자 안에 있으면 두 번 넣지 않는다', () => {
    const grid = buildParameterGrid({
      takeProfitPercents: [10],
      stopLossPercents: [-5],
      minimumTurnover60s: [5e8],
      maximumWeightPercents: [20],
      includeBandless: false,
      baseline: BASELINE,
    });

    expect(grid).toHaveLength(1);
  });

  it('라벨이 같아 보이는 값도 서로 다른 후보로 남긴다', () => {
    // 억 단위 두 자리 반올림으로 3.001억과 3.002억이 같은 라벨이 되면, 중복 제거가
    // 후보 하나를 조용히 삼켜 사용자가 준 수와 실제로 도는 수가 갈린다.
    const grid = buildParameterGrid({
      takeProfitPercents: [10],
      stopLossPercents: [-5],
      minimumTurnover60s: [300_100_000, 300_200_000],
      maximumWeightPercents: [20],
      includeBandless: false,
      baseline: BASELINE,
    });

    expect(
      grid.slice(1).map((combination) => combination.minimumTurnover60),
    ).toEqual([300_100_000, 300_200_000]);
    // 리포트가 라벨로 조합을 집계하므로 라벨도 갈려 있어야 표에서 두 행이 겹치지 않는다.
    expect(new Set(grid.map(formatCombinationLabel)).size).toBe(grid.length);
  });

  it('무밴드 대조군은 밴드 축과 무관하게 조합마다 하나만 붙는다', () => {
    const grid = buildParameterGrid({
      takeProfitPercents: [5, 10],
      stopLossPercents: [-3, -5],
      minimumTurnover60s: [5e8],
      maximumWeightPercents: [20],
      includeBandless: true,
      baseline: BASELINE,
    });

    expect(
      grid.filter((combination) => combination.takeProfitPercent === null),
    ).toHaveLength(1);
    expect(grid.map(formatCombinationLabel)).toContain('무밴드 · 5억 · 20%');
  });
});

describe('rankWithinWindow', () => {
  it('초과수익이 높은 조합이 1위다', () => {
    const ranks = rankWithinWindow([
      outcomeOf(1, 'A', -1),
      outcomeOf(1, 'B', 3),
      outcomeOf(1, 'C', 1),
    ]);

    expect(ranks.get('B')).toBe(1);
    expect(ranks.get('C')).toBe(2);
    expect(ranks.get('A')).toBe(3);
  });

  it('초과수익이 없는 조합은 0 으로 치지 않고 맨 뒤로 민다', () => {
    // 없는 것을 0 으로 치면 전 조합이 마이너스인 창에서 1위가 된다.
    const ranks = rankWithinWindow([
      outcomeOf(1, 'A', null),
      outcomeOf(1, 'B', -5),
    ]);

    expect(ranks.get('B')).toBe(1);
    expect(ranks.get('A')).toBe(2);
  });

  it('값이 없는 조합끼리도 동점이다', () => {
    // null 을 동점에서 빼면 라벨 알파벳 순이 순위가 되어, 아무것도 재지 못한 조합들
    // 사이에 이름으로 매긴 서열이 생기고 그것이 walk-forward 후보 선택까지 개입한다.
    const ranks = rankWithinWindow([
      outcomeOf(1, 'A', null),
      outcomeOf(1, 'B', null),
      outcomeOf(1, 'C', -5),
    ]);

    expect(ranks.get('C')).toBe(1);
    expect(ranks.get('A')).toBe(2);
    expect(ranks.get('B')).toBe(2);
  });

  it('동점은 같은 순위를 준다', () => {
    const ranks = rankWithinWindow([
      outcomeOf(1, 'A', 2),
      outcomeOf(1, 'B', 2),
      outcomeOf(1, 'C', 1),
    ]);

    expect(ranks.get('A')).toBe(1);
    expect(ranks.get('B')).toBe(1);
    expect(ranks.get('C')).toBe(3);
  });
});

describe('summarizeCombinations', () => {
  const OUTCOMES = [
    outcomeOf(1, '현행', 1),
    outcomeOf(1, '후보', 2),
    outcomeOf(2, '현행', 3),
    outcomeOf(2, '후보', -1),
    outcomeOf(3, '현행', 0),
    outcomeOf(3, '후보', 4),
  ];

  it('순위 평균이 낮은 조합을 앞에 세운다', () => {
    const summaries = summarizeCombinations({
      outcomes: OUTCOMES,
      baselineLabel: '현행',
    });

    expect(summaries.map((summary) => summary.label)).toEqual(['후보', '현행']);
    expect(summaries[0].ranks).toEqual([1, 2, 1]);
    expect(summaries[0].meanRank).toBeCloseTo(4 / 3);
    expect(summaries[0].medianRank).toBe(1);
  });

  it('현행값 대비 승수를 창 단위로 센다', () => {
    const summaries = summarizeCombinations({
      outcomes: OUTCOMES,
      baselineLabel: '현행',
    });
    const candidate = summaries.find((summary) => summary.label === '후보');

    expect(candidate?.winCount).toBe(2);
    expect(candidate?.comparableCount).toBe(3);
  });

  it('회전은 합계와 창 수를 함께 남겨 창당으로 환산되게 한다', () => {
    // 창 수를 안 남기면 합계만으로는 창당 회전을 낼 수 없고, 창 수가 다른 조합
    // (한 창에서 값이 없어 빠진 조합)끼리 합계를 견주면 회전이 부풀거나 줄어든다.
    const summaries = summarizeCombinations({
      outcomes: [
        { ...outcomeOf(1, '후보', 1), filledCount: 37, closedCount: 18 },
        { ...outcomeOf(2, '후보', 1), filledCount: 41, closedCount: 20 },
        { ...outcomeOf(1, '현행', 0), filledCount: 10, closedCount: 5 },
      ],
      baselineLabel: '현행',
    });
    const candidate = summaries.find((summary) => summary.label === '후보');
    const baseline = summaries.find((summary) => summary.label === '현행');

    expect(candidate?.filledCountTotal).toBe(78);
    expect(candidate?.windowCount).toBe(2);
    expect(candidate?.closedCountTotal).toBe(38);
    expect(baseline?.filledCountTotal).toBe(10);
    expect(baseline?.windowCount).toBe(1);
  });

  it('최대손실은 평균이 아니라 최악을 남긴다', () => {
    const summaries = summarizeCombinations({
      outcomes: [
        { ...outcomeOf(1, '후보', 1), maximumLossPercent: -5 },
        { ...outcomeOf(2, '후보', 1), maximumLossPercent: -40 },
      ],
      baselineLabel: '현행',
    });

    expect(summaries[0].worstMaximumLossPercent).toBe(-40);
  });
});

describe('evaluateWalkForward', () => {
  // 창 1·2 에서는 후보가 앞서고 창 3 에서 뒤집힌다. 표본 밖 판정이 창 3 만 본다.
  const OUTCOMES = [
    outcomeOf(1, '현행', 0),
    outcomeOf(1, '후보', 5),
    outcomeOf(2, '현행', 0),
    outcomeOf(2, '후보', 5),
    outcomeOf(3, '현행', 2),
    outcomeOf(3, '후보', -3),
  ];

  it('앞선 창들로 고르고 그 다음 창에서만 성적을 본다', () => {
    const verdicts = evaluateWalkForward({
      outcomes: OUTCOMES,
      baselineLabel: '현행',
    });

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      windowIndex: 3,
      trainedWindowCount: 2,
      chosenLabel: '후보',
      chosenExcessReturnPercent: -3,
      baselineExcessReturnPercent: 2,
      won: false,
    });
  });

  it('훈련 창이 모자라면 판정하지 않는다', () => {
    const verdicts = evaluateWalkForward({
      outcomes: OUTCOMES.filter((outcome) => outcome.windowIndex <= 2),
      baselineLabel: '현행',
    });

    expect(verdicts).toEqual([]);
  });

  it('탐색이 현행값을 그대로 고른 창은 승패를 매기지 않는다', () => {
    const verdicts = evaluateWalkForward({
      outcomes: [
        outcomeOf(1, '현행', 5),
        outcomeOf(1, '후보', 0),
        outcomeOf(2, '현행', 5),
        outcomeOf(2, '후보', 0),
        outcomeOf(3, '현행', 1),
        outcomeOf(3, '후보', 9),
      ],
      baselineLabel: '현행',
    });

    expect(verdicts[0].chosenLabel).toBe('현행');
    expect(verdicts[0].won).toBeNull();
  });
});

describe('summarizeAcrossConditions', () => {
  // 한 조건에서 1위이고 다른 조건에서 꼴찌인 값 vs 두 조건 모두 중위인 값.
  // 평균으로 세우면 전자가 이기고, 최악으로 세우면 후자가 이긴다.
  const CONDITIONS: ConditionOutcomes[] = [
    {
      conditionLabel: '마찰 없음',
      outcomes: [
        outcomeOf(1, '취약', 10),
        outcomeOf(1, '강건', 5),
        outcomeOf(1, '현행', 0),
        outcomeOf(2, '취약', 10),
        outcomeOf(2, '강건', 5),
        outcomeOf(2, '현행', 0),
      ],
    },
    {
      conditionLabel: '마찰 큼',
      outcomes: [
        outcomeOf(1, '취약', -20),
        outcomeOf(1, '강건', 5),
        outcomeOf(1, '현행', 0),
        outcomeOf(2, '취약', -20),
        outcomeOf(2, '강건', 5),
        outcomeOf(2, '현행', 0),
      ],
    },
  ];

  it('한 조건의 붕괴를 다른 조건의 우수함이 덮지 못한다', () => {
    const summaries = summarizeAcrossConditions({
      conditions: CONDITIONS,
      baselineLabel: '현행',
    });

    // '강건' 은 마찰 없음에서 2위(취약이 1위)·마찰 큼에서 1위라 최악이 2 이고,
    // '취약' 은 1위·3위라 최악이 3 이다. 최악 기준이라 '강건' 이 이긴다 —
    // 평균으로 세우면 취약(2.0)이 강건(1.5)에 밀리지 않아 붕괴가 가려진다.
    expect(summaries[0].label).toBe('강건');
    expect(summaries[0].worstMeanRank).toBe(2);
    expect(summaries[0].meanRankByCondition).toEqual([2, 1]);
    const fragile = summaries.find((summary) => summary.label === '취약');
    expect(fragile?.meanRankByCondition).toEqual([1, 3]);
    expect(fragile?.worstMeanRank).toBe(3);
    expect(fragile?.bestMeanRank).toBe(1);
  });

  it('조건 하나에만 있는 조합도 그 조건의 순위로 센다', () => {
    const summaries = summarizeAcrossConditions({
      conditions: [
        CONDITIONS[0],
        {
          conditionLabel: '마찰 큼',
          outcomes: [outcomeOf(1, '현행', 0)],
        },
      ],
      baselineLabel: '현행',
    });
    const fragile = summaries.find((summary) => summary.label === '취약');

    expect(fragile?.meanRankByCondition).toEqual([1, null]);
    expect(fragile?.worstMeanRank).toBe(1);
  });
});

describe('evaluateRobustWalkForward', () => {
  // 창 1·2 에서는 '취약' 이 마찰 없음 조건에서 앞서지만 마찰 큼 조건에서 뒤진다.
  // 최악 기준으로 고르면 '강건' 이 뽑히고, 창 3 에서 두 조건 모두를 본다.
  const conditionsOf = (
    fragileAtWindow3: number,
    robustAtWindow3: number,
  ): ConditionOutcomes[] => [
    {
      conditionLabel: '마찰 없음',
      outcomes: [
        outcomeOf(1, '취약', 10),
        outcomeOf(1, '강건', 5),
        outcomeOf(1, '현행', 0),
        outcomeOf(2, '취약', 10),
        outcomeOf(2, '강건', 5),
        outcomeOf(2, '현행', 0),
        outcomeOf(3, '취약', fragileAtWindow3),
        outcomeOf(3, '강건', robustAtWindow3),
        outcomeOf(3, '현행', 1),
      ],
    },
    {
      conditionLabel: '마찰 큼',
      outcomes: [
        outcomeOf(1, '취약', -20),
        outcomeOf(1, '강건', 5),
        outcomeOf(1, '현행', 0),
        outcomeOf(2, '취약', -20),
        outcomeOf(2, '강건', 5),
        outcomeOf(2, '현행', 0),
        outcomeOf(3, '취약', fragileAtWindow3),
        outcomeOf(3, '강건', robustAtWindow3),
        outcomeOf(3, '현행', 1),
      ],
    },
  ];

  it('최악 기준으로 고르고 모든 조건에서 이겨야 승이다', () => {
    const verdicts = evaluateRobustWalkForward({
      conditions: conditionsOf(9, 9),
      baselineLabel: '현행',
    });

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].chosenLabel).toBe('강건');
    expect(verdicts[0].byCondition.map((entry) => entry.won)).toEqual([
      true,
      true,
    ]);
    expect(verdicts[0].wonEveryCondition).toBe(true);
  });

  it('한 조건에서만 져도 승이 아니다', () => {
    // 창 3 의 두 조건 성적을 갈라 한쪽만 현행보다 낮게 만든다.
    const conditions = conditionsOf(9, 9);
    conditions[1].outcomes = conditions[1].outcomes.map((outcome) =>
      outcome.windowIndex === 3 && outcome.label === '강건'
        ? { ...outcome, excessReturnPercent: -5 }
        : outcome,
    );
    const verdicts = evaluateRobustWalkForward({
      conditions,
      baselineLabel: '현행',
    });

    expect(verdicts[0].byCondition.map((entry) => entry.won)).toEqual([
      true,
      false,
    ]);
    expect(verdicts[0].wonEveryCondition).toBe(false);
  });
});
