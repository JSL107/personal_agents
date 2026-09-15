import {
  LabeledFinding,
  matchReplayedFinding,
  ReplayedFinding,
  scoreReplay,
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
