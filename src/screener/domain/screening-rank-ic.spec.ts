import {
  RankIcRow,
  spearmanCorrelation,
  summarizeRankIc,
} from './screening-rank-ic';

const day = (date: string): Date => new Date(`${date}T00:00:00.000Z`);

// 순위 1~n 의 수익률을 받아 한 회차의 행을 만든다.
const run = (
  runId: number,
  returns: number[],
  entry = '2026-09-01',
  horizon = '2026-09-08',
): RankIcRow[] =>
  returns.map((returnPct, index) => ({
    runId,
    rank: index + 1,
    returnPct,
    entryTradeDate: day(entry),
    horizonTradeDate: day(horizon),
  }));

describe('spearmanCorrelation', () => {
  it('동률은 평균 순위로 주어 입력 순서가 결과를 바꾸지 않는다', () => {
    const forward = spearmanCorrelation([1, 2, 3, 4], [1, 1, 3, 4]);
    const shuffled = spearmanCorrelation([4, 2, 1, 3], [4, 1, 1, 3]);

    expect(forward).toBeCloseTo(shuffled as number, 12);
    expect(forward).toBeCloseTo(0.9487, 4);
  });

  it('한쪽이 전부 같은 값이면 0 이 아니라 null 이다', () => {
    expect(spearmanCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
  });
});

describe('summarizeRankIc', () => {
  it('순위 1위가 가장 많이 오르면 +1, 거꾸로면 −1 이다', () => {
    expect(summarizeRankIc(run(1, [5, 4, 3, 2, 1])).meanIc).toBeCloseTo(1, 12);
    expect(summarizeRankIc(run(1, [1, 2, 3, 4, 5])).meanIc).toBeCloseTo(-1, 12);
  });

  it('종목이 5개 미만이거나 수익률이 전부 같은 회차는 세지 않는다', () => {
    const summary = summarizeRankIc([
      ...run(1, [4, 3, 2, 1]),
      ...run(2, [0, 0, 0, 0, 0]),
    ]);

    expect(summary).toEqual({
      eligibleRunCount: 0,
      sampledRunCount: 0,
      meanIc: null,
      positiveRunCount: 0,
      tStatistic: null,
    });
  });

  it('보유 구간이 겹치는 회차는 빼고 최신 회차부터 고른다', () => {
    const summary = summarizeRankIc([
      // 가장 이른 회차. 평가일이 최신 회차 진입일보다 앞서 들어온다.
      ...run(1, [5, 4, 3, 2, 1], '2026-09-01', '2026-09-08'),
      // 평가일이 최신 회차 진입일과 같은 날이라 그날 장중이 겹친다 → 빠진다.
      ...run(2, [1, 2, 3, 4, 5], '2026-09-02', '2026-09-09'),
      ...run(3, [5, 4, 3, 2, 1], '2026-09-09', '2026-09-16'),
    ]);

    expect(summary.eligibleRunCount).toBe(3);
    expect(summary.sampledRunCount).toBe(2);
    expect(summary.meanIc).toBeCloseTo(1, 12);
    expect(summary.positiveRunCount).toBe(2);
  });

  it('겹침은 회차 안에서 가장 늦은 평가일로 판정한다', () => {
    // 회차 1의 한 종목만 봉이 비어 평가일이 하루 늦다. 그 하루가 회차 2 진입일과 겹친다.
    const late = run(1, [5, 4, 3, 2, 1], '2026-09-01', '2026-09-08');
    late[4] = { ...late[4], horizonTradeDate: day('2026-09-09') };

    const summary = summarizeRankIc([
      ...late,
      ...run(2, [5, 4, 3, 2, 1], '2026-09-09', '2026-09-16'),
    ]);

    expect(summary.sampledRunCount).toBe(1);
  });

  it('t 는 평균 ÷ (표준편차 ÷ √n) 이고 표본이 하나면 null 이다', () => {
    const single = summarizeRankIc(run(1, [5, 4, 3, 2, 1]));
    expect(single.tStatistic).toBeNull();

    // IC 가 +1, +1, −1 인 세 회차: 평균 1/3, 표준편차 √(4/3) → t = 0.5.
    const summary = summarizeRankIc([
      ...run(1, [5, 4, 3, 2, 1], '2026-09-01', '2026-09-05'),
      ...run(2, [5, 4, 3, 2, 1], '2026-09-10', '2026-09-15'),
      ...run(3, [1, 2, 3, 4, 5], '2026-09-20', '2026-09-25'),
    ]);
    expect(summary.sampledRunCount).toBe(3);
    expect(summary.tStatistic).toBeCloseTo(0.5, 12);
  });
});
