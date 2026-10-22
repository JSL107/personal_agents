import {
  buildFindingRecoveryFacts,
  carryForwardPriorFindings,
  extractPriorFindingKeys,
  findNovelFactIds,
  hasPlanRealityMismatch,
  PlanRealityFact,
  readReportedFactStates,
  RecoveryLifecycle,
  toComparableKey,
  toReportedFactStates,
} from './plan-reality.diff';
import { PoShadowContext } from './po-shadow.type';

const KEY = 'acme/app#264';
const NOW = new Date('2026-09-10T04:00:00.000Z');
const day = (n: number): Date =>
  new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const contextWith = (
  overrides: Partial<PoShadowContext> = {},
): PoShadowContext => ({
  assignedTasks: { issues: [], pullRequests: [] },
  waitingItems: [],
  activePullRequests: [],
  mergedPullRequests: [],
  mergedLookupAvailable: true,
  newMentions: [],
  notionTasks: [],
  ownGithubLogin: null,
  degradedSources: [],
  ...overrides,
});

const assigned = (key: string): Partial<PoShadowContext> => {
  const [repo, number] = key.split('#');
  return {
    assignedTasks: {
      issues: [],
      pullRequests: [
        {
          repo,
          number: Number(number),
          title: 't',
          url: `https://github.com/${repo}/pull/${number}`,
          draft: false,
          updatedAt: '2026-09-09T00:00:00Z',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    },
  };
};

const lifecycle = (value: RecoveryLifecycle | null) =>
  new Map<string, RecoveryLifecycle | null>([[KEY, value]]);

describe('toComparableKey — 키 추출이 판정보다 먼저 돈다', () => {
  it('정규형 GitHub 접두어 넷을 통과시킨다', () => {
    expect(toComparableKey(`merged:${KEY}`)).toBe(KEY);
    expect(toComparableKey(`stalled:${KEY}`)).toBe(KEY);
    expect(toComparableKey(`unplanned:${KEY}`)).toBe(KEY);
    // 실측상 not-found 도 전부 정규형이라 번호 유일 매칭이 필요 없다.
    expect(toComparableKey(`not-found:${KEY}`)).toBe(KEY);
  });

  it('unverifiable·mention·failed 는 제외한다', () => {
    // 실측: unverifiable 은 전부 rollover:N 형태라 GitHub 항목이 아니다.
    expect(toComparableKey('unverifiable:rollover:1')).toBeNull();
    expect(toComparableKey('mention:C123:1712345678.9')).toBeNull();
    // id 에 시각이 들어가 회차마다 달라진다.
    expect(
      toComparableKey('failed:CAREER_MATE:2026-09-09T04:00:00.000Z'),
    ).toBeNull();
  });

  it('GitHub 정규형이 아닌 접미부는 통과시키지 않는다', () => {
    expect(toComparableKey('unplanned:TSK-1371')).toBeNull();
  });
});

describe('extractPriorFindingKeys — 최초 회차를 남긴다', () => {
  it('같은 키가 여러 회차에 있으면 가장 이른 endedAt 을 쓴다', () => {
    const priors = extractPriorFindingKeys([
      { factIds: [`stalled:${KEY}`], endedAt: day(3) },
      { factIds: [`unplanned:${KEY}`], endedAt: day(9) },
      { factIds: [`unplanned:${KEY}`], endedAt: day(1) },
    ]);
    expect(priors).toHaveLength(1);
    expect(priors[0].firstReportedAt).toEqual(day(9));
  });

  it('대조 불가 접두어만 있으면 키가 나오지 않는다', () => {
    expect(
      extractPriorFindingKeys([
        { factIds: ['unverifiable:rollover:2'], endedAt: day(2) },
      ]),
    ).toEqual([]);
  });
});

describe('buildFindingRecoveryFacts — 네 갈래가 전수를 덮는다', () => {
  const prior = [{ key: KEY, firstReportedAt: day(9) }];

  it('담당 목록에 남아 있으면 UNMOVED 이고 sequence 가 파생된다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith(assigned(KEY)),
      lifecycles: new Map(),
      now: NOW,
    });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].kind).toBe('FINDING_UNMOVED');
    expect(result.facts[0].sequence).toBe(1);
    expect(result.movementTally.unresolved).toBe(1);
  });

  it('머지됐으면 MERGED 이고 분모에 든다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith(),
      lifecycles: lifecycle({
        state: 'closed',
        mergedAt: '2026-09-08T00:00:00Z',
        isPullRequest: true,
      }),
      now: NOW,
    });
    expect(result.facts[0].kind).toBe('FINDING_MERGED');
    expect(result.movementTally.merged).toBe(1);
  });

  it('머지 없이 닫혔으면 ABANDONED — 포기를 해소로 세지 않는다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith(),
      lifecycles: lifecycle({
        state: 'closed',
        mergedAt: null,
        isPullRequest: true,
      }),
      now: NOW,
    });
    expect(result.facts[0].kind).toBe('FINDING_ABANDONED');
    expect(result.movementTally.abandoned).toBe(1);
    expect(result.movementTally.merged).toBe(0);
  });

  it('닫힌 이슈도 ABANDONED 로 회수한다 — 머지 문구는 쓰지 않는다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith(),
      lifecycles: lifecycle({
        state: 'closed',
        mergedAt: null,
        isPullRequest: false,
      }),
      now: NOW,
    });
    expect(result.facts[0].kind).toBe('FINDING_ABANDONED');
    expect(result.facts[0].detail).toContain('이슈가 닫힘');
    expect(result.facts[0].detail).not.toContain('머지');
    expect(result.movementTally.abandoned).toBe(1);
  });

  it('열려 있는데 담당에서 빠졌으면 UNASSIGNED 이고 분모에서 빠진다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith(),
      lifecycles: lifecycle({
        state: 'open',
        mergedAt: null,
        isPullRequest: true,
      }),
      now: NOW,
    });
    expect(result.facts[0].kind).toBe('FINDING_UNASSIGNED');
    expect(result.movementTally.unassigned).toBe(1);
    expect(result.movementTally.merged).toBe(0);
    expect(result.movementTally.unresolved).toBe(0);
  });

  it('단건 조회가 실패한 키만 대조 불가로 세고 다른 키는 정상 판정한다', () => {
    const other = 'acme/app#999';
    const result = buildFindingRecoveryFacts({
      priorFindings: [
        { key: KEY, firstReportedAt: day(9) },
        { key: other, firstReportedAt: day(9) },
      ],
      context: contextWith(),
      lifecycles: new Map<string, RecoveryLifecycle | null>([
        [KEY, null],
        [
          other,
          {
            state: 'closed',
            mergedAt: '2026-09-08T00:00:00Z',
            isPullRequest: true,
          },
        ],
      ]),
      now: NOW,
    });
    expect(result.uncomparableCount).toBe(1);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].kind).toBe('FINDING_MERGED');
  });

  it('담당 조회가 실패한 회차에는 부재를 근거로 삼지 않는다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith({ assignedTasks: null }),
      lifecycles: lifecycle({
        state: 'closed',
        mergedAt: null,
        isPullRequest: true,
      }),
      now: NOW,
    });
    expect(result.facts).toEqual([]);
    // 수집기가 이미 `GitHub 담당 목록` 라벨을 붙였으므로 회수 쪽 라벨을 겹쳐 달지 않는다.
    // 그래서 uncomparableCount 는 올리지 않고 별도 플래그로 알린다.
    expect(result.assignedLookupFailed).toBe(true);
    expect(result.uncomparableCount).toBe(0);
  });
});

describe('회수 사실의 label·url — 실측 키가 잘리지 않아야 한다', () => {
  const longKey = 'schoolbell-e/sbe-api-v5-puppeteer#135';

  it('owner 를 떼어 번호를 보존한다 (37자 키가 30자 절단에 걸리던 것)', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: [{ key: longKey, firstReportedAt: day(9) }],
      context: contextWith(),
      lifecycles: new Map<string, RecoveryLifecycle | null>([
        [longKey, { state: 'closed', mergedAt: null, isPullRequest: true }],
      ]),
      now: NOW,
    });
    expect(result.facts[0].label).toBe('sbe-api-v5-puppeteer#135');
    expect(result.facts[0].label).toContain('#135');
  });

  it('클릭 가능한 url 을 싣는다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: [{ key: longKey, firstReportedAt: day(9) }],
      context: contextWith(),
      lifecycles: new Map<string, RecoveryLifecycle | null>([
        [
          longKey,
          {
            state: 'closed',
            mergedAt: '2026-09-08T00:00:00Z',
            isPullRequest: true,
          },
        ],
      ]),
      now: NOW,
    });
    expect(result.facts[0].url).toBe(
      'https://github.com/schoolbell-e/sbe-api-v5-puppeteer/pull/135',
    );
  });
});

describe('7일 임계 — 미만이면 사실을 만들지 않되 미해결에는 센다', () => {
  it('6일이면 사실이 없고 unresolved 만 오른다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: [{ key: KEY, firstReportedAt: day(6) }],
      context: contextWith(assigned(KEY)),
      lifecycles: new Map(),
      now: NOW,
    });
    expect(result.facts).toEqual([]);
    expect(result.movementTally.unresolved).toBe(1);
  });

  it('7일이면 사실이 생긴다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: [{ key: KEY, firstReportedAt: day(7) }],
      context: contextWith(assigned(KEY)),
      lifecycles: new Map(),
      now: NOW,
    });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0].sequence).toBe(1);
  });

  it('모델이 중간 회차에서 인용하지 않아도 최초 시각 기준이라 sequence 가 이어진다', () => {
    const priors = extractPriorFindingKeys([
      { factIds: [`unplanned:${KEY}`], endedAt: day(15) },
      { factIds: [], endedAt: day(8) },
      { factIds: [`unplanned:${KEY}`], endedAt: day(1) },
    ]);
    const result = buildFindingRecoveryFacts({
      priorFindings: priors,
      context: contextWith(assigned(KEY)),
      lifecycles: new Map(),
      now: NOW,
    });
    expect(result.facts[0].sequence).toBe(2);
  });
});

describe('waitingItem.reason 을 detail 에 싣는다', () => {
  it('오늘 담당 항목의 url 로 조인한다 — PLANNED_STALLED 존재에 기대지 않는다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: [{ key: KEY, firstReportedAt: day(9) }],
      context: contextWith({
        ...assigned(KEY),
        waitingItems: [
          {
            title: 't',
            url: 'https://github.com/acme/app/pull/264',
            reason: '승인·충돌 없음 — 머지만 남음',
          },
        ],
      }),
      lifecycles: new Map(),
      now: NOW,
    });
    expect(result.facts[0].detail).toContain('승인·충돌 없음 — 머지만 남음');
  });
});

describe('권고 철회 — sequence 3(21일)부터 detail 에서 reason 을 뺀다', () => {
  const REASON = '승인·충돌 없음 — 머지만 남음';
  const recoverAfter = (days: number, withReason = true) =>
    buildFindingRecoveryFacts({
      priorFindings: [{ key: KEY, firstReportedAt: day(days) }],
      context: contextWith({
        ...assigned(KEY),
        waitingItems: withReason
          ? [
              {
                title: 't',
                url: 'https://github.com/acme/app/pull/264',
                reason: REASON,
              },
            ]
          : [],
      }),
      lifecycles: new Map(),
      now: NOW,
    });

  it('sequence 2(20일)까지는 reason 을 싣는다', () => {
    const result = recoverAfter(20);
    expect(result.facts[0].sequence).toBe(2);
    expect(result.facts[0].detail).toBe(`14일째 미이동 — ${REASON}`);
    expect(result.reasonWithdrawnKeys).toEqual([]);
  });

  it('sequence 3(21일)이면 reason 없이 경과만 남긴다', () => {
    const result = recoverAfter(21);
    expect(result.facts[0].sequence).toBe(3);
    expect(result.facts[0].detail).toBe('21일째 미이동');
    expect(result.reasonWithdrawnKeys).toEqual([KEY]);
  });

  it('사유가 원래 없던 키는 철회로 세지 않는다 — 존치 판정이 부풀지 않게', () => {
    const result = recoverAfter(21, false);
    expect(result.facts[0].detail).toBe('21일째 미이동');
    expect(result.reasonWithdrawnKeys).toEqual([]);
  });
});

describe('hasPlanRealityMismatch — 검토를 켜는 조건', () => {
  const fact = (
    kind: PlanRealityFact['kind'],
    sequence?: number,
  ): PlanRealityFact => ({ id: 'x', kind, label: 'l', detail: 'd', sequence });
  // 직전 상태를 모르는 회차 — 모든 사실이 새 것이다.
  const firstRun = (facts: PlanRealityFact[]): boolean =>
    hasPlanRealityMismatch(facts, findNovelFactIds(facts, null));

  it('sequence 1 인 UNMOVED 만 있으면 quiet 를 유지한다', () => {
    expect(firstRun([fact('FINDING_UNMOVED', 1)])).toBe(false);
  });

  it('sequence 2 부터 검토를 켠다', () => {
    expect(firstRun([fact('FINDING_UNMOVED', 2)])).toBe(true);
  });

  it('ABANDONED 는 처음 확인한 회차에 켠다 — 포기는 대표가 알아야 한다', () => {
    expect(firstRun([fact('FINDING_ABANDONED')])).toBe(true);
  });

  it('MERGED·UNASSIGNED·본인이 연 항목은 켜지 않는다', () => {
    expect(firstRun([fact('FINDING_MERGED')])).toBe(false);
    expect(firstRun([fact('FINDING_UNASSIGNED')])).toBe(false);
    expect(firstRun([fact('UNPLANNED_SELF_AUTHORED')])).toBe(false);
  });

  // 실측(10-13~22): 머지 없이 닫힌 PR 이 닷새 연속 같은 사실로 검토를 켰다.
  it('직전 회차가 이미 올린 ABANDONED 는 다시 켜지 않는다', () => {
    const facts = [fact('FINDING_ABANDONED')];
    const previous = toReportedFactStates(facts);

    expect(
      hasPlanRealityMismatch(facts, findNovelFactIds(facts, previous)),
    ).toBe(false);
  });

  it('UNMOVED 는 구간이 올라간 회차에만 다시 켠다', () => {
    const yesterday = toReportedFactStates([fact('FINDING_UNMOVED', 2)]);

    const same = [fact('FINDING_UNMOVED', 2)];
    const crossed = [fact('FINDING_UNMOVED', 3)];

    expect(
      hasPlanRealityMismatch(same, findNovelFactIds(same, yesterday)),
    ).toBe(false);
    expect(
      hasPlanRealityMismatch(crossed, findNovelFactIds(crossed, yesterday)),
    ).toBe(true);
  });

  it('1구간에서 2구간으로 넘어간 날 켠다', () => {
    const yesterday = toReportedFactStates([fact('FINDING_UNMOVED', 1)]);
    const today = [fact('FINDING_UNMOVED', 2)];

    expect(
      hasPlanRealityMismatch(today, findNovelFactIds(today, yesterday)),
    ).toBe(true);
  });
});

describe('findNovelFactIds', () => {
  const fact = (id: string, sequence?: number): PlanRealityFact => ({
    id,
    kind: 'PLANNED_STALLED',
    label: 'l',
    detail: 'd',
    sequence,
  });

  it('직전 상태를 모르면 전부 새 것으로 본다 — 모르는 채로 지적을 삼키지 않는다', () => {
    expect(findNovelFactIds([fact('a'), fact('b')], null)).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('직전에 없던 id 만 새 것이다', () => {
    const previous = toReportedFactStates([fact('a')]);

    expect(findNovelFactIds([fact('a'), fact('b')], previous)).toEqual(
      new Set(['b']),
    );
  });

  it('구간이 내려가면 새 것이 아니다', () => {
    const previous = toReportedFactStates([fact('a', 3)]);

    expect(findNovelFactIds([fact('a', 2)], previous)).toEqual(new Set());
  });
});

describe('toReportedFactStates', () => {
  const fact = (id: string): PlanRealityFact => ({
    id,
    kind: 'PLANNED_STALLED',
    label: 'l',
    detail: 'd',
  });

  // 담당 조회가 죽은 날 GitHub 사실이 0건이 된다. 그 빈자리를 저장하면 다음 날 전부 다시 켜진다.
  it('조회가 실패한 출처의 사실만 직전 상태를 이어 둔다', () => {
    const previous = [
      { id: 'stalled:acme/app#1' },
      { id: `finding-unmoved:${KEY}`, sequence: 2 },
      { id: 'mention:C1:1' },
    ];

    expect(
      toReportedFactStates([fact('goal-unserved:today')], {
        previousStates: previous,
        degradedFactSources: ['GITHUB_ASSIGNED'],
      }),
    ).toEqual([
      { id: 'goal-unserved:today' },
      { id: 'stalled:acme/app#1' },
      { id: `finding-unmoved:${KEY}`, sequence: 2 },
    ]);
  });

  // #885 리뷰: 다른 출처가 실패한 날 정상 조회에서 풀린 대기까지 이어 두면, 같은 대기가 다시 생겨도
  // 새 사실로 잡히지 않는다.
  it('실패하지 않은 출처에서 해소된 사실은 이어 두지 않는다', () => {
    const stored = toReportedFactStates([], {
      previousStates: [{ id: 'stalled:acme/app#1' }],
      degradedFactSources: ['PRODUCT_GOAL'],
    });
    const stalledAgain = [fact('stalled:acme/app#1')];

    expect(stored).toEqual([]);
    expect(
      hasPlanRealityMismatch(
        stalledAgain,
        findNovelFactIds(stalledAgain, stored),
      ),
    ).toBe(true);
  });

  it('정상 회차는 이번 사실만 남긴다', () => {
    expect(
      toReportedFactStates([fact('c')], {
        previousStates: toReportedFactStates([fact('a')]),
      }),
    ).toEqual([{ id: 'c' }]);
  });

  // 근거 검증에서 지적이 전부 버려진 회차는 아무것도 알리지 못했다 — 다음 회차에 다시 새 것이어야 한다.
  it('전달되지 않은 새 사실은 직전 상태로 남겨 다음 회차에 다시 새 것으로 보이게 한다', () => {
    const unmoved = (sequence: number): PlanRealityFact => ({
      id: `finding-unmoved:${KEY}`,
      kind: 'FINDING_UNMOVED',
      label: 'l',
      detail: 'd',
      sequence,
      firstReportedAt: day(14).toISOString(),
    });
    const previous = toReportedFactStates([unmoved(1)]);
    const today = [unmoved(2), fact('new')];

    const stored = toReportedFactStates(today, {
      previousStates: previous,
      undeliveredFactIds: findNovelFactIds(today, previous),
    });

    expect(stored).toEqual(previous);
    expect(hasPlanRealityMismatch(today, findNovelFactIds(today, stored))).toBe(
      true,
    );
  });
});

describe('readReportedFactStates', () => {
  it('기록 전 회차(필드 없음)는 null 이다', () => {
    expect(readReportedFactStates({ slackUserId: 'U1' })).toBeNull();
    expect(readReportedFactStates(null)).toBeNull();
  });

  it('저장한 상태를 그대로 읽고 형태가 깨진 줄은 버린다', () => {
    const states = toReportedFactStates([
      {
        id: `finding-unmoved:${KEY}`,
        kind: 'FINDING_UNMOVED',
        label: 'l',
        detail: 'd',
        sequence: 2,
        firstReportedAt: day(15).toISOString(),
      },
    ]);

    expect(
      readReportedFactStates({ reportedFacts: [...states, { id: 3 }] }),
    ).toEqual(states);
  });
});

describe('extractPriorFindingKeys — 본인이 연 항목', () => {
  // #885 리뷰: 배포 전 "계획 밖" 으로 인용된 본인 PR 이 회수 경로로 미이동이 되어 검토를 다시 켜면 안 된다.
  it('본인이 연 항목의 계획 밖 인용은 회수하지 않고, 다른 이유의 인용은 그대로 추적한다', () => {
    const result = extractPriorFindingKeys(
      [
        {
          factIds: [`unplanned:${KEY}`, 'unplanned:acme/app#9'],
          endedAt: day(10),
        },
        { factIds: ['stalled:acme/app#5'], endedAt: day(9) },
        { factIds: ['unplanned:acme/app#5'], endedAt: day(8) },
      ],
      new Set([KEY, 'acme/app#5']),
    );

    expect(result).toEqual([
      { key: 'acme/app#9', firstReportedAt: day(10) },
      { key: 'acme/app#5', firstReportedAt: day(9) },
    ]);
  });
});

describe('carryForwardPriorFindings — 미이동 나이 고정', () => {
  const unmovedState = (key: string, firstReportedAt: Date) => ({
    id: `finding-unmoved:${key}`,
    sequence: 3,
    firstReportedAt: firstReportedAt.toISOString(),
  });

  // 실측: 최초 인용이 30일 창 밖으로 밀리면 창 안의 다음 인용이 최초가 되어 나이가 줄었다.
  it('직전 회차가 들고 있던 더 이른 최초 시각을 이어받는다', () => {
    const result = carryForwardPriorFindings(
      [{ key: KEY, firstReportedAt: day(20) }],
      [unmovedState(KEY, day(29))],
    );

    expect(result).toEqual([{ key: KEY, firstReportedAt: day(29) }]);
  });

  it('창 안의 시각이 더 이르면 그대로 둔다', () => {
    const result = carryForwardPriorFindings(
      [{ key: KEY, firstReportedAt: day(29) }],
      [unmovedState(KEY, day(20))],
    );

    expect(result).toEqual([{ key: KEY, firstReportedAt: day(29) }]);
  });

  it('창에서 사라진 키도 직전 회차가 미이동으로 들고 있었으면 계속 추적한다', () => {
    const result = carryForwardPriorFindings([], [unmovedState(KEY, day(35))]);

    expect(result).toEqual([{ key: KEY, firstReportedAt: day(35) }]);
    const recovered = buildFindingRecoveryFacts({
      priorFindings: result,
      context: contextWith({
        assignedTasks: {
          issues: [],
          pullRequests: [
            {
              number: 264,
              title: 't',
              repo: 'acme/app',
              url: 'https://github.com/acme/app/pull/264',
              draft: false,
              updatedAt: day(1).toISOString(),
              requestedReviewers: [],
              isApproved: false,
            },
          ],
        },
      }),
      lifecycles: new Map(),
      now: NOW,
    });
    expect(recovered.facts[0]).toMatchObject({
      kind: 'FINDING_UNMOVED',
      sequence: 5,
      firstReportedAt: day(35).toISOString(),
    });
  });

  it('미이동이 아닌 상태와 직전 상태가 없는 경우는 건드리지 않는다', () => {
    const prior = [{ key: KEY, firstReportedAt: day(3) }];

    expect(carryForwardPriorFindings(prior, null)).toEqual(prior);
    expect(
      carryForwardPriorFindings(prior, [
        {
          id: `finding-abandoned:${KEY}`,
          firstReportedAt: day(40).toISOString(),
        },
      ]),
    ).toEqual(prior);
  });
});
