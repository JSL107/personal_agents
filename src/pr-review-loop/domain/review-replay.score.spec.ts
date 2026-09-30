import {
  compareBodies,
  compareMissedIntactWithBaseline,
  compareWithBaseline,
  FindingReplayResult,
  intactMissedIdsOf,
  isSameSample,
  LabeledFinding,
  matchReplayedFinding,
  readBaselineSummaries,
  REPLAY_SCORER_VERSION,
  ReplayedFinding,
  replayedFindingsOf,
  sampleIdsOf,
  scoreReplay,
  scorerVersionOf,
  skippedCountOf,
  summarizeTrials,
  summarizeTrialsByTruncation,
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

  it.each([14, 26])(
    '줄 차이가 6이고 본문이 다르면 매칭하지 않는다: %s',
    (line) => {
      expect(
        matchReplayedFinding(LABELED, [
          { ...REPLAYED, line, body: '전혀 다른 결함' },
        ]),
      ).toBeUndefined();
    },
  );

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

describe('matchReplayedFinding — 본문 근거', () => {
  const card: LabeledFinding = {
    ...LABELED,
    line: 160,
    body: '기존 행의 placement 를 조회하기 전에 content 누락만으로 400 을 반환해 이미 로고인 배너의 수정이 실패합니다.',
  };

  it('가까운 줄이어도 본문이 전혀 다른 결함이면 매칭하지 않는다', () => {
    const unrelated = {
      ...REPLAYED,
      line: 158,
      body: '날짜 파싱이 존재하지 않는 달력 날짜를 허용합니다.',
    };
    expect(matchReplayedFinding(card, [unrelated])).toBeUndefined();
  });

  it('가까운 줄이고 코드 식별자가 같으면 문장이 달라도 매칭한다', () => {
    const sameIdentifier = {
      ...REPLAYED,
      line: 158,
      body: '`placement` 재전송 요청이 거부됩니다.',
    };
    expect(matchReplayedFinding(card, [sameIdentifier])).toBe(sameIdentifier);
  });

  it('줄이 멀어도 본문이 많이 겹치면 같은 결함으로 매칭한다', () => {
    const farButSame = {
      ...REPLAYED,
      line: 132,
      body: '기존 행을 조회하기 전에 content 누락만으로 400 을 반환해 이미 로고인 행의 부분 수정이 실패합니다.',
    };
    expect(matchReplayedFinding(card, [farButSame])).toBe(farButSame);
  });

  it('줄이 멀고 본문 겹침이 적으면 매칭하지 않는다', () => {
    const farAndWeak = {
      ...REPLAYED,
      line: 132,
      body: '로고 URL 이 http 를 허용해 혼합 콘텐츠로 차단됩니다.',
    };
    expect(matchReplayedFinding(card, [farAndWeak])).toBeUndefined();
  });

  it('같은 파일이면 줄이 아주 멀어도 본문이 많이 겹칠 때 매칭한다', () => {
    const veryFar = { ...REPLAYED, line: 900, body: card.body };
    expect(matchReplayedFinding(card, [veryFar])).toBe(veryFar);
  });

  it('가까운 후보와 먼 후보가 모두 맞으면 가까운 쪽을 고른다', () => {
    const near = { ...REPLAYED, line: 161, body: card.body };
    const far = { ...REPLAYED, line: 130, body: card.body };
    expect(matchReplayedFinding(card, [far, near])).toBe(near);
  });
});

describe('compareBodies', () => {
  it('한쪽에 한글 조각도 식별자도 없으면 판정할 수 없다', () => {
    expect(compareBodies('18행', '같은 결함 설명')).toBeNull();
  });

  it('짧은 쪽 기준으로 한글 두 글자 조각의 공통 비율을 잰다', () => {
    // 가나다 → 가나·나다, 가나라 → 가나·나라 — 짧은 쪽 2개 중 1개 공통
    expect(compareBodies('가나다', '가나라')?.overlap).toBe(0.5);
  });

  it('흔한 영문 낱말과 PR 번호는 공통 식별자로 세지 않는다', () => {
    expect(
      compareBodies('PR #12 의 diff 에서 `null`', 'PR #12 diff null 확인')
        ?.sharedIdentifiers,
    ).toBe(0);
    expect(
      compareBodies('`inputByRawId` 덮어쓰기', 'inputByRawId 가 한 키만 저장')
        ?.sharedIdentifiers,
    ).toBe(1);
  });

  it('가까운 다른 결함이 언어 키워드만 공유하면 재현으로 세지 않는다', () => {
    const card: LabeledFinding = {
      ...LABELED,
      body: '만료된 토큰을 거부하지 않고 return 해 인증이 우회됩니다.',
    };
    const other = {
      ...REPLAYED,
      line: 22,
      body: '날짜 포맷 error 를 삼켜 return 값이 비어 버립니다.',
    };
    expect(compareBodies(card.body, other.body)?.sharedIdentifiers).toBe(0);
    expect(matchReplayedFinding(card, [other])).toBeUndefined();
  });
});

describe('scorerVersionOf', () => {
  it('버전 칸이 없는 보고서는 규칙 1 로 읽는다', () => {
    expect(scorerVersionOf({ groups: [] })).toBe(1);
    expect(scorerVersionOf(null)).toBe(1);
  });

  it('버전 칸이 있으면 그 값을 읽는다', () => {
    expect(scorerVersionOf({ scorerVersion: REPLAY_SCORER_VERSION })).toBe(
      REPLAY_SCORER_VERSION,
    );
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
        body: '원래 지적',
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
      missed: { total: 0, reproduced: 0, rate: null },
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
      missed: { total: 0, reproduced: 0, rate: null },
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

  it.each([
    ['REJECTED', [0.3, 0.4], '나쁜 쪽'],
    ['REJECTED', [0.0, 0.05], '좋은 쪽'],
    ['FIXED', [0.3, 0.4], '좋은 쪽'],
    ['FIXED', [0.0, 0.05], '나쁜 쪽'],
    ['MISSED', [0.0, 0.05], '나쁜 쪽'],
    ['MISSED', [0.3, 0.4], '좋은 쪽'],
  ] as const)('%s 가 %j 로 벗어나면 %s', (label, rates, direction) => {
    expect(
      compareWithBaseline(summaryOf([...rates]), summaryOf([0.1, 0.2]), label)
        .direction,
    ).toBe(direction);
  });

  it('범위 안이거나 라벨이 없으면 방향을 붙이지 않는다', () => {
    expect(
      compareWithBaseline(
        summaryOf([0.1, 0.3]),
        summaryOf([0.2, 0.25]),
        'FIXED',
      ).direction,
    ).toBeUndefined();
    expect(
      compareWithBaseline(summaryOf([0.5, 0.6]), summaryOf([0.1, 0.2]))
        .direction,
    ).toBeUndefined();
  });

  // 요청은 2회였어도 한 회차가 통째로 스킵되면 관측은 하나뿐이다.
  it('스킵으로 실제 측정 회차가 1번뿐이면 판단 불가', () => {
    const current: TrialSummary = {
      ...summaryOf([0.4]),
      trials: 2,
      rates: [0.4, null],
    };

    const comparison = compareWithBaseline(current, summaryOf([0.1, 0.12]));

    expect(comparison.verdict).toBe('판단 불가');
    expect(comparison.reason).toContain('실제로 측정된 회차');
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

describe('compareMissedIntactWithBaseline', () => {
  it('기준선에 안 잘림 집계가 있으면 범위 겹침으로 판정한다', () => {
    expect(
      compareMissedIntactWithBaseline(
        summaryOf([0.2, 0.3]),
        summaryOf([0.46, 0.69, 0.62]),
        true,
      ),
    ).toMatchObject({ verdict: '변동 범위 밖', direction: '나쁜 쪽' });
  });

  // 합친 값으로 대신 비교하면 잘림 0% 가 섞여 기준이 달라진다.
  it('기준선에 분리 집계가 없으면 판단 불가', () => {
    const comparison = compareMissedIntactWithBaseline(
      summaryOf([0.5, 0.6]),
      undefined,
      true,
    );

    expect(comparison).toMatchObject({
      verdict: '판단 불가',
      baselineMean: null,
      currentMean: 0.55,
    });
    expect(comparison.reason).toContain('byDiffTruncation');
  });

  // 잘림 판정이 바뀌면 전체 카드가 같아도 안 잘린 카드가 다르다.
  it('안 잘린 미탐 카드가 기준선과 다르면 판단 불가', () => {
    const comparison = compareMissedIntactWithBaseline(
      summaryOf([0.2, 0.3]),
      summaryOf([0.46, 0.69, 0.62]),
      false,
    );

    expect(comparison.verdict).toBe('판단 불가');
    expect(comparison.direction).toBeUndefined();
    expect(comparison.reason).toContain('안 잘린 미탐 카드가 다르다');
  });
});

describe('intactMissedIdsOf', () => {
  it('diff 안 잘린 그룹의 MISSED id 만 정렬해 모은다', () => {
    const report = {
      groups: [
        {
          diffTruncated: false,
          results: [
            { id: -2, label: 'MISSED' },
            { id: 7, label: 'FIXED' },
          ],
        },
        { diffTruncated: true, results: [{ id: -3, label: 'MISSED' }] },
        { diffTruncated: false, results: [{ id: -5, label: 'MISSED' }] },
        { diffTruncated: false, results: [{ id: -2, label: 'MISSED' }] },
      ],
    };

    expect(intactMissedIdsOf(report)).toEqual([-5, -2]);
  });
});

describe('readBaselineSummaries', () => {
  it('미탐 안 잘림 집계를 byDiffTruncation 에서 읽는다', () => {
    const intact = summaryOf([0.46, 0.69, 0.62]);
    const summaries = readBaselineSummaries({
      trials: {
        rejected: summaryOf([0.1]),
        fixed: summaryOf([0.5]),
        missed: summaryOf([0.24, 0.36, 0.32]),
        byDiffTruncation: {
          missed: { intact, truncated: summaryOf([0, 0, 0]) },
        },
      },
    });

    expect(summaries?.missedIntact).toEqual(intact);
  });

  it('안 잘림 집계의 형식이 틀리면 거부한다', () => {
    expect(
      readBaselineSummaries({
        trials: {
          rejected: summaryOf([0.1]),
          fixed: summaryOf([0.5]),
          byDiffTruncation: { missed: { intact: { total: 3 } } },
        },
      }),
    ).toBeNull();
  });

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

  // 필드가 빠진 요약을 받으면 비교에 NaN·undefined 가 섞인다.
  it('필드가 빠지거나 타입이 틀린 요약은 거부한다', () => {
    const withoutMean: Partial<TrialSummary> = summaryOf([0.2, 0.3]);
    delete withoutMean.meanRate;

    expect(
      readBaselineSummaries({
        trials: { rejected: withoutMean, fixed: summaryOf([0.5, 0.6]) },
      }),
    ).toBeNull();
    expect(
      readBaselineSummaries({
        trials: {
          rejected: { ...summaryOf([0.2]), rates: ['0.2'] },
          fixed: summaryOf([0.5]),
        },
      }),
    ).toBeNull();
  });

  it('반복 측정 전 보고서에서 rate 가 빠지면 거부한다', () => {
    expect(
      readBaselineSummaries({
        score: {
          rejected: { total: 4, reproduced: 1 },
          fixed: { total: 2, reproduced: 2, rate: 1 },
        },
      }),
    ).toBeNull();
  });

  it('형식을 모르면 null', () => {
    expect(readBaselineSummaries({ foo: 1 })).toBeNull();
    expect(readBaselineSummaries(null)).toBeNull();
  });
});

describe('sampleIdsOf · isSameSample', () => {
  // 스킵된 카드는 재현율 계산에 안 들어가므로 측정 표본이 아니다. 스킵은 따로 센다.
  it('실제로 측정된 카드 id 만 중복 없이 정렬해 내고, 스킵은 따로 센다', () => {
    const report = {
      groups: [
        { results: [{ id: 5 }, { id: 2 }] },
        { results: [{ id: 5 }, { id: 2 }] },
      ],
      skipped: [{ findingIds: [9] }],
    };

    expect(sampleIdsOf(report)).toEqual([2, 5]);
    expect(skippedCountOf(report)).toBe(1);
    expect(skippedCountOf({ groups: [] })).toBe(0);
  });

  it('같은 카드 집합일 때만 같은 표본이다', () => {
    expect(isSameSample([2, 5], [2, 5])).toBe(true);
    expect(isSameSample([2, 5], [2, 6])).toBe(false);
    expect(isSameSample([2], [2, 5])).toBe(false);
  });
});

describe('scoreReplay — 미탐', () => {
  const missed: LabeledFinding = {
    id: -1,
    label: 'MISSED',
    filePath: 'BannerModel.ts',
    line: 258,
    category: '',
    body: '정렬 비교가 NaN',
  };

  // 외부 리뷰 요약표는 파일 이름만 적는다 — 재생 지적의 전체 경로와 마지막 조각으로 맞춘다.
  it('파일 이름만 있는 미탐을 전체 경로의 재생 지적과 매칭하고 미탐 재현율을 낸다', () => {
    const score = scoreReplay([
      {
        labeled: missed,
        replayed: [
          {
            file: 'src/models/BannerModel.ts',
            line: 260,
            category: 'X',
            body: '',
          },
        ],
      },
    ]);

    expect(score.missed).toEqual({ total: 1, reproduced: 1, rate: 1 });
    expect(score.rejected.total).toBe(0);
  });

  // 둘 다 전체 경로면 종전처럼 전체를 비교한다 — 이름만 같은 다른 파일을 잡지 않게.
  it('둘 다 경로가 있으면 디렉터리가 다를 때 매칭하지 않는다', () => {
    const score = scoreReplay([
      {
        labeled: { ...LABELED, filePath: 'src/a/index.ts', line: 10 },
        replayed: [
          { file: 'src/b/index.ts', line: 10, category: 'X', body: '' },
        ],
      },
    ]);

    expect(score.rejected.reproduced).toBe(0);
  });
});

describe('readBaselineSummaries — 미탐', () => {
  it('미탐 요약이 있으면 함께 읽는다', () => {
    const missed = summaryOf([0.3, 0.4]);

    expect(
      readBaselineSummaries({
        trials: {
          rejected: summaryOf([0.2, 0.3]),
          fixed: summaryOf([0.8, 0.9]),
          missed,
        },
      })?.missed,
    ).toEqual(missed);
  });

  it('미탐 요약의 형식이 틀리면 거부한다', () => {
    expect(
      readBaselineSummaries({
        trials: {
          rejected: summaryOf([0.2, 0.3]),
          fixed: summaryOf([0.8, 0.9]),
          missed: { trials: 2 },
        },
      }),
    ).toBeNull();
  });
});

describe('summarizeTrialsByTruncation', () => {
  it('diff 잘림 여부로 그룹을 나눠 회차별로 요약한다', () => {
    const split = summarizeTrialsByTruncation(
      [
        {
          trial: 1,
          diffTruncated: false,
          results: [result(1, 'REJECTED', true)],
        },
        {
          trial: 1,
          diffTruncated: true,
          results: [result(2, 'REJECTED', false)],
        },
        {
          trial: 2,
          diffTruncated: false,
          results: [result(1, 'REJECTED', false)],
        },
        {
          trial: 2,
          diffTruncated: true,
          results: [result(2, 'REJECTED', false)],
        },
      ],
      2,
      'REJECTED',
    );

    expect(split.intact).toMatchObject({
      total: 1,
      rates: [1, 0],
      anyTrial: 1,
      everyTrial: 0,
    });
    expect(split.truncated).toMatchObject({
      total: 1,
      rates: [0, 0],
      anyTrial: 0,
    });
  });

  it('한쪽에 그룹이 없으면 그쪽은 카드 0 · 재현율 null 이다', () => {
    const split = summarizeTrialsByTruncation(
      [{ trial: 1, diffTruncated: false, results: [result(1, 'FIXED', true)] }],
      1,
      'FIXED',
    );

    expect(split.truncated).toMatchObject({ total: 0, meanRate: null });
    expect(split.intact).toMatchObject({ total: 1, meanRate: 1 });
  });
});

describe('replayedFindingsOf', () => {
  it('원장의 리뷰 결과에서 재생 지적을 꺼내고 없는 칸은 싣지 않는다', () => {
    expect(
      replayedFindingsOf({
        summary: '요약',
        findings: [
          REPLAYED,
          { category: 'TEST', body: '파일 없는 지적', severity: 'NIT' },
        ],
      }),
    ).toEqual([REPLAYED, { category: 'TEST', body: '파일 없는 지적' }]);
  });

  // 틀린 지적만 버리면 원래 실행과 다른 입력으로 재현율이 계산된다.
  it.each([
    null,
    {},
    { findings: 'x' },
    { findings: [{ ...REPLAYED, line: '20' }] },
    { findings: [{ ...REPLAYED, body: undefined }] },
  ])('형식이 틀리면 null: %j', (output) => {
    expect(replayedFindingsOf(output)).toBeNull();
  });
});
