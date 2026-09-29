import {
  compareWithBaseline,
  FindingReplayResult,
  isSameSample,
  LabeledFinding,
  matchReplayedFinding,
  readBaselineSummaries,
  ReplayedFinding,
  sampleIdsOf,
  scoreReplay,
  summarizeTrials,
  TrialSummary,
} from './review-replay.score';

const LABELED: LabeledFinding = {
  id: 1,
  label: 'REJECTED',
  filePath: 'src/example.ts',
  line: 20,
  category: 'CORRECTNESS',
  body: '원래 지적',
};
const REPLAYED: ReplayedFinding = {
  file: 'src/example.ts',
  line: 20,
  category: 'CORRECTNESS',
  body: '재생 지적',
};

describe('matchReplayedFinding', () => {
  it.each([
    ' ./src/example.ts ',
    'a/src/example.ts',
    'b/src/example.ts',
    './a/src/example.ts',
  ])('양쪽 경로 접두사와 공백을 정규화한다: %s', (filePath) => {
    const candidate = { ...REPLAYED, file: ' b/src/example.ts ' };
    const result = matchReplayedFinding({ ...LABELED, filePath }, [candidate]);
    expect(result).toBe(candidate);
  });

  it.each([15, 25])(
    '줄 차이가 5이면 category가 달라도 매칭한다: %s',
    (line) => {
      const candidate = { ...REPLAYED, line, category: 'SECURITY' };
      expect(matchReplayedFinding(LABELED, [candidate])).toBe(candidate);
    },
  );

  it.each([14, 26])('줄 차이가 6이면 매칭하지 않는다: %s', (line) => {
    expect(
      matchReplayedFinding(LABELED, [{ ...REPLAYED, line }]),
    ).toBeUndefined();
  });

  it.each(['other.ts', undefined])(
    '파일이 다르거나 없으면 매칭하지 않는다: %s',
    (file) => {
      expect(
        matchReplayedFinding(LABELED, [{ ...REPLAYED, file }]),
      ).toBeUndefined();
    },
  );

  it('원래 줄이 null이면 같은 파일과 category로 매칭한다', () => {
    const labeled = { ...LABELED, line: null };
    const candidate = { ...REPLAYED, line: 100 };
    expect(matchReplayedFinding(labeled, [candidate])).toBe(candidate);
    expect(
      matchReplayedFinding(labeled, [{ ...candidate, category: 'TEST' }]),
    ).toBeUndefined();
  });

  it('재생 줄이 없으면 같은 파일과 category로 매칭한다', () => {
    const candidate = { ...REPLAYED, line: undefined };
    expect(matchReplayedFinding(LABELED, [candidate])).toBe(candidate);
    expect(
      matchReplayedFinding(LABELED, [{ ...candidate, category: 'TEST' }]),
    ).toBeUndefined();
  });

  it('양쪽 줄이 없어도 같은 파일과 category로 매칭한다', () => {
    const candidate = { ...REPLAYED, line: undefined };
    expect(matchReplayedFinding({ ...LABELED, line: null }, [candidate])).toBe(
      candidate,
    );
  });

  it('원래 파일이 null이면 파일과 줄에 관계없이 category로 매칭한다', () => {
    const labeled = { ...LABELED, filePath: null };
    const candidate = { ...REPLAYED, file: 'other.ts', line: 100 };
    expect(matchReplayedFinding(labeled, [candidate])).toBe(candidate);
    expect(
      matchReplayedFinding(labeled, [{ ...REPLAYED, category: 'TEST' }]),
    ).toBeUndefined();
  });

  it('후보 중 줄 차이가 가장 작은 것을 선택한다', () => {
    const closest = { ...REPLAYED, line: 21 };
    const candidates = [
      { ...REPLAYED, line: undefined },
      { ...REPLAYED, line: 24 },
      closest,
    ];
    expect(matchReplayedFinding(LABELED, candidates)).toBe(closest);
  });

  it('후보가 없으면 매칭하지 않는다', () => {
    expect(matchReplayedFinding(LABELED, [])).toBeUndefined();
  });
});

describe('scoreReplay — 최대 매칭', () => {
  // 앞 카드가 가까운 후보를 먼저 집어가면 뒤 카드가 굶는다. 개수가 최대가 되게 배정한다.
  it('카드 순서 때문에 잡을 수 있는 재현을 놓치지 않는다', () => {
    const near: ReplayedFinding = {
      file: 'src/example.ts',
      line: 18,
      category: 'CORRECTNESS',
      body: '18행',
    };
    const far: ReplayedFinding = {
      file: 'src/example.ts',
      line: 25,
      category: 'CORRECTNESS',
      body: '25행',
    };
    const replayed = [near, far];

    const score = scoreReplay([
      { labeled: { ...LABELED, id: 1, line: 20 }, replayed },
      { labeled: { ...LABELED, id: 2, line: 15 }, replayed },
    ]);

    expect(score.rejected).toEqual({ total: 2, reproduced: 2, rate: 1 });
    expect(score.results[0].matched).toBe(far);
    expect(score.results[1].matched).toBe(near);
  });
});

describe('scoreReplay — 후보 소진', () => {
  // 한 재생 지적이 가까운 카드 여러 장을 동시에 채우면 재현 수가 부풀려진다.
  it('같은 재생 지적을 두 카드가 나눠 갖지 않는다', () => {
    const replayed: ReplayedFinding[] = [
      {
        file: 'src/example.ts',
        line: 20,
        category: 'CORRECTNESS',
        body: '하나뿐',
      },
    ];
    const first: LabeledFinding = { ...LABELED, id: 1, line: 20 };
    const second: LabeledFinding = { ...LABELED, id: 2, line: 22 };

    const score = scoreReplay([
      { labeled: first, replayed },
      { labeled: second, replayed },
    ]);

    expect(score.results.map((result) => result.reproduced)).toEqual([
      true,
      false,
    ]);
    expect(score.rejected).toEqual({ total: 2, reproduced: 1, rate: 0.5 });
  });

  it('이미 매칭된 후보를 넘기면 그 후보는 건너뛴다', () => {
    const candidate: ReplayedFinding = { ...REPLAYED };

    expect(
      matchReplayedFinding(LABELED, [candidate], new Set([candidate])),
    ).toBeUndefined();
  });
});

describe('scoreReplay', () => {
  it('표본이 없으면 두 비율 모두 null이다', () => {
    expect(scoreReplay([])).toEqual({
      rejected: { total: 0, reproduced: 0, rate: null },
      fixed: { total: 0, reproduced: 0, rate: null },
      results: [],
    });
  });

  it('REJECTED와 FIXED를 분리 집계하고 각 id와 매칭 결과를 남긴다', () => {
    // 카드마다 자기 회차의 재생 결과를 본다 — 후보는 회차별로 별개 객체다.
    const fixedReplayed: ReplayedFinding = { ...REPLAYED };
    const score = scoreReplay([
      { labeled: LABELED, replayed: [REPLAYED] },
      { labeled: { ...LABELED, id: 2 }, replayed: [] },
      {
        labeled: { ...LABELED, id: 3, label: 'FIXED' },
        replayed: [fixedReplayed],
      },
    ]);
    expect(score).toEqual({
      rejected: { total: 2, reproduced: 1, rate: 0.5 },
      fixed: { total: 1, reproduced: 1, rate: 1 },
      results: [
        { id: 1, label: 'REJECTED', reproduced: true, matched: REPLAYED },
        { id: 2, label: 'REJECTED', reproduced: false },
        { id: 3, label: 'FIXED', reproduced: true, matched: fixedReplayed },
      ],
    });
  });

  it('표본이 있으나 재발하지 않으면 0이고 없는 라벨은 null이다', () => {
    const score = scoreReplay([{ labeled: LABELED, replayed: [] }]);
    expect(score.rejected).toEqual({ total: 1, reproduced: 0, rate: 0 });
    expect(score.fixed).toEqual({ total: 0, reproduced: 0, rate: null });
  });
});

const result = (
  id: number,
  label: 'REJECTED' | 'FIXED',
  reproduced: boolean,
): FindingReplayResult => ({ id, label, reproduced });

describe('summarizeTrials', () => {
  it('회차별 재현율과 한 번이라도 · 매번 재현된 카드 수를 낸다', () => {
    const summary = summarizeTrials(
      [
        [result(1, 'REJECTED', true), result(2, 'REJECTED', false)],
        [result(1, 'REJECTED', true), result(2, 'REJECTED', true)],
        [result(1, 'REJECTED', true), result(2, 'REJECTED', false)],
      ],
      'REJECTED',
    );

    expect(summary).toMatchObject({
      trials: 3,
      total: 2,
      rates: [0.5, 1, 0.5],
      minRate: 0.5,
      maxRate: 1,
      anyTrial: 2,
      everyTrial: 1,
    });
    expect(summary.meanRate).toBeCloseTo(2 / 3);
  });

  it('다른 라벨은 세지 않는다', () => {
    const summary = summarizeTrials(
      [[result(1, 'REJECTED', true), result(2, 'FIXED', false)]],
      'FIXED',
    );

    expect(summary).toMatchObject({ total: 1, rates: [0], anyTrial: 0 });
  });

  // 어느 회차에서 스킵된 카드는 그 회차에 재현됐는지 모르므로 "매번" 으로 세지 않는다.
  it('스킵된 회차가 있는 카드는 매번 재현으로 세지 않는다', () => {
    const summary = summarizeTrials(
      [[result(1, 'FIXED', true)], [], [result(1, 'FIXED', true)]],
      'FIXED',
    );

    expect(summary.rates).toEqual([1, null, 1]);
    expect(summary.everyTrial).toBe(0);
    expect(summary.anyTrial).toBe(1);
  });
});

const summaryOf = (rates: number[]): TrialSummary => ({
  trials: rates.length,
  total: 10,
  rates,
  meanRate: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
  minRate: Math.min(...rates),
  maxRate: Math.max(...rates),
  anyTrial: 0,
  everyTrial: 0,
});

describe('compareWithBaseline', () => {
  it('회차별 범위가 겹치면 변동 범위 안', () => {
    const comparison = compareWithBaseline(
      summaryOf([0.3, 0.4, 0.2]),
      summaryOf([0.35, 0.5, 0.45]),
    );

    expect(comparison.verdict).toBe('변동 범위 안');
    expect(comparison.delta).toBeCloseTo(0.3 - 13 / 30);
  });

  it('범위가 겹치지 않으면 변동 범위 밖', () => {
    expect(
      compareWithBaseline(summaryOf([0.1, 0.15]), summaryOf([0.4, 0.5]))
        .verdict,
    ).toBe('변동 범위 밖');
  });

  // 1회끼리의 차이는 회차 변동일 수 있어 어떤 결론도 낼 수 없다.
  it('어느 쪽이든 1회면 판단 불가', () => {
    const comparison = compareWithBaseline(
      summaryOf([0.1, 0.12]),
      summaryOf([0.5]),
    );

    expect(comparison.verdict).toBe('판단 불가');
    expect(comparison.reason).toContain('--trials 2');
  });
});

describe('readBaselineSummaries', () => {
  it('반복 측정 보고서는 trials 를 그대로 읽는다', () => {
    const rejected = summaryOf([0.2, 0.3]);
    const fixed = summaryOf([0.8, 0.9]);

    expect(readBaselineSummaries({ trials: { rejected, fixed } })).toEqual({
      rejected,
      fixed,
    });
  });

  // 지금까지 쌓인 보고서와도 비교가 끊기지 않게, score 만 있는 보고서는 1회차로 읽는다.
  it('반복 측정 전 보고서는 score 를 1회차로 읽는다', () => {
    const summaries = readBaselineSummaries({
      score: {
        rejected: { total: 4, reproduced: 1, rate: 0.25 },
        fixed: { total: 2, reproduced: 2, rate: 1 },
      },
    });

    expect(summaries?.rejected).toMatchObject({
      trials: 1,
      rates: [0.25],
      meanRate: 0.25,
    });
    expect(summaries?.fixed.anyTrial).toBe(2);
  });

  it('형식을 모르면 null', () => {
    expect(readBaselineSummaries({ foo: 1 })).toBeNull();
    expect(readBaselineSummaries(null)).toBeNull();
  });
});

describe('sampleIdsOf · isSameSample', () => {
  // 회차마다 같은 카드가 반복되고, 스킵된 카드도 표본에 들어간다.
  it('재생·스킵된 카드 id 를 중복 없이 정렬해 낸다', () => {
    const ids = sampleIdsOf({
      groups: [
        { results: [{ id: 5 }, { id: 2 }] },
        { results: [{ id: 5 }, { id: 2 }] },
      ],
      skipped: [{ findingIds: [9] }],
    });

    expect(ids).toEqual([2, 5, 9]);
  });

  it('같은 카드 집합일 때만 같은 표본이다', () => {
    expect(isSameSample([2, 5], [2, 5])).toBe(true);
    expect(isSameSample([2, 5], [2, 6])).toBe(false);
    expect(isSameSample([2], [2, 5])).toBe(false);
  });
});
