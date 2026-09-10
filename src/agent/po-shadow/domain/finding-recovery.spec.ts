import {
  buildFindingRecoveryFacts,
  extractPriorFindingKeys,
  hasPlanRealityMismatch,
  PlanRealityFact,
  RecoveryLifecycle,
  toComparableKey,
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
  failedRunsToday: [],
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
      lifecycles: lifecycle({ state: 'closed', mergedAt: null }),
      now: NOW,
    });
    expect(result.facts[0].kind).toBe('FINDING_ABANDONED');
    expect(result.movementTally.abandoned).toBe(1);
    expect(result.movementTally.merged).toBe(0);
  });

  it('열려 있는데 담당에서 빠졌으면 UNASSIGNED 이고 분모에서 빠진다', () => {
    const result = buildFindingRecoveryFacts({
      priorFindings: prior,
      context: contextWith(),
      lifecycles: lifecycle({ state: 'open', mergedAt: null }),
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
        [other, { state: 'closed', mergedAt: '2026-09-08T00:00:00Z' }],
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
      lifecycles: lifecycle({ state: 'closed', mergedAt: null }),
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
        [longKey, { state: 'closed', mergedAt: null }],
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
        [longKey, { state: 'closed', mergedAt: '2026-09-08T00:00:00Z' }],
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

describe('hasPlanRealityMismatch — 검토를 켜는 조건', () => {
  const fact = (
    kind: PlanRealityFact['kind'],
    sequence?: number,
  ): PlanRealityFact => ({ id: 'x', kind, label: 'l', detail: 'd', sequence });

  it('sequence 1 인 UNMOVED 만 있으면 quiet 를 유지한다', () => {
    expect(hasPlanRealityMismatch([fact('FINDING_UNMOVED', 1)])).toBe(false);
  });

  it('sequence 2 부터 검토를 켠다', () => {
    expect(hasPlanRealityMismatch([fact('FINDING_UNMOVED', 2)])).toBe(true);
  });

  it('ABANDONED 는 항상 켠다 — 포기는 대표가 알아야 한다', () => {
    expect(hasPlanRealityMismatch([fact('FINDING_ABANDONED')])).toBe(true);
  });

  it('MERGED·UNASSIGNED 는 켜지 않는다', () => {
    expect(hasPlanRealityMismatch([fact('FINDING_MERGED')])).toBe(false);
    expect(hasPlanRealityMismatch([fact('FINDING_UNASSIGNED')])).toBe(false);
  });
});
