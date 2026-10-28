import { PoShadowContext } from './po-shadow.type';
import { GOAL_DEADLINE_RISK_DAYS, ProductGoalRecord } from './product-goal';
import { buildProductGoalFacts } from './product-goal.facts';

// KST 2026-10-08 12:00
const now = new Date('2026-10-08T03:00:00Z');
const DAY = 86_400_000;

const contextWith = (
  openTitles: string[] = [],
  mergedTitles: string[] = [],
): PoShadowContext => ({
  assignedTasks: {
    issues: [],
    pullRequests: openTitles.map((title, index) => ({
      number: 100 + index,
      title,
      repo: 'acme/app',
      url: `https://github.com/acme/app/pull/${100 + index}`,
      draft: false,
      updatedAt: '2026-10-07T00:00:00Z',
      requestedReviewers: [],
      isApproved: false,
    })),
  },
  waitingItems: [],
  activePullRequests: [],
  mergedPullRequests: mergedTitles.map((title, index) => ({
    number: 200 + index,
    title,
    body: '',
    repo: 'acme/app',
    url: `https://github.com/acme/app/pull/${200 + index}`,
    state: 'merged' as const,
    mergedAt: '2026-10-08T02:00:00Z',
    updatedAt: '2026-10-08T02:00:00Z',
    additions: 1,
    deletions: 1,
    changedFilesCount: 1,
  })),
  mergedLookupAvailable: true,
  newMentions: [],
  notionTasks: [],
  ownGithubLogin: null,
  degradedSources: [],
});

const goal = (
  overrides: Partial<ProductGoalRecord> = {},
): ProductGoalRecord => ({
  id: 1,
  slackUserId: 'U1',
  title: '보존기간 파일 파기',
  kind: 'TASK',
  why: null,
  successCriterion: '운영 배포 완료',
  keywords: ['보존기간', '파기'],
  dueDate: null,
  closedAt: null,
  createdAt: new Date(now.getTime() - 3 * DAY),
  ...overrides,
});

const build = (
  goals: ProductGoalRecord[],
  {
    context = contextWith([], ['feat(file): 보존기간 만료 파일 파기']),
  }: {
    context?: PoShadowContext;
  } = {},
) => buildProductGoalFacts({ goals, context, now });

describe('buildProductGoalFacts', () => {
  it('활성 목표가 없으면 아무것도 만들지 않는다', () => {
    expect(build([])).toEqual({ facts: [] });
  });

  it('목표에 안 붙은 작업은 GOAL_UNSERVED 한 건으로 묶는다', () => {
    const result = build([goal()], {
      context: contextWith(
        [],
        [
          'feat(file): 보존기간 만료 파일 파기',
          'fix(auth): 토큰 갱신',
          'chore: 의존성 갱신',
        ],
      ),
    });
    expect(result.facts).toEqual([
      {
        id: 'goal-unserved:today',
        kind: 'GOAL_UNSERVED',
        label: '목표 밖 작업 2건',
        detail: 'fix(auth): 토큰 갱신 · chore: 의존성 갱신',
      },
    ]);
  });

  it('키워드 없는 목표만 있으면 목표 밖 작업을 내지 않는다', () => {
    const keywordless = goal({
      title: '이직하기',
      keywords: [],
      createdAt: new Date(now.getTime() - 40 * DAY),
    });
    expect(
      build([keywordless], {
        context: contextWith([], ['refactor(types): Pick 제거']),
      }),
    ).toEqual({ facts: [] });
  });

  it('키워드 없는 목표가 섞여도 목표 밖 판정은 키워드 있는 목표로 한다', () => {
    const result = build(
      [goal({ id: 2, title: '이직하기', keywords: [] }), goal()],
      {
        context: contextWith(
          [],
          ['feat(file): 보존기간 만료 파일 파기', 'fix(auth): 토큰 갱신'],
        ),
      },
    );
    expect(result.facts).toEqual([
      {
        id: 'goal-unserved:today',
        kind: 'GOAL_UNSERVED',
        label: '목표 밖 작업 1건',
        detail: 'fix(auth): 토큰 갱신',
      },
    ]);
  });

  it('모든 작업이 목표에 붙으면 GOAL_UNSERVED 를 내지 않는다', () => {
    expect(build([goal()]).facts).toEqual([]);
  });

  it('기한 임박 + 붙은 열린 항목이 있으면 GOAL_DEADLINE_RISK', () => {
    const result = build(
      [goal({ dueDate: new Date('2026-10-13T00:00:00Z') })],
      { context: contextWith(['보존기간 파기 배치 추가']) },
    );
    expect(result.facts).toContainEqual({
      id: 'goal-deadline:1',
      kind: 'GOAL_DEADLINE_RISK',
      label: '보존기간 파일 파기',
      detail: '기한 D-5 · 붙은 열린 항목 1건',
      sequence: 1,
    });
  });

  // 같은 목표가 매일 다시 켜지지 않되, 임박 → 당일 → 초과로 악화된 날은 새 사실이어야 한다.
  it('기한 위험은 임박·당일·초과 단계를 sequence 로 올린다', () => {
    const stageOn = (dueDate: string): number | undefined =>
      build([goal({ dueDate: new Date(dueDate) })], {
        context: contextWith(['보존기간 파기 배치 추가']),
      }).facts.find((fact) => fact.kind === 'GOAL_DEADLINE_RISK')?.sequence;

    expect(stageOn('2026-10-13T00:00:00Z')).toBe(1);
    expect(stageOn('2026-10-08T00:00:00Z')).toBe(2);
    expect(stageOn('2026-10-06T00:00:00Z')).toBe(3);
  });

  it('기한이 멀거나 붙은 열린 항목이 없으면 기한 위험이 아니다', () => {
    const far = build([goal({ dueDate: new Date('2026-10-31T00:00:00Z') })], {
      context: contextWith(['보존기간 파기 배치 추가']),
    });
    const nothingOpen = build([
      goal({ dueDate: new Date('2026-10-13T00:00:00Z') }),
    ]);
    expect(far.facts.map((fact) => fact.kind)).not.toContain(
      'GOAL_DEADLINE_RISK',
    );
    expect(nothingOpen.facts.map((fact) => fact.kind)).not.toContain(
      'GOAL_DEADLINE_RISK',
    );
  });

  it('닫힌 목표는 무시한다', () => {
    const closed = goal({
      closedAt: new Date('2026-10-05T00:00:00Z'),
      dueDate: new Date('2026-10-01T00:00:00Z'),
    });
    expect(
      build([closed], { context: contextWith(['보존기간 파기']) }),
    ).toEqual({ facts: [] });
  });
});

describe('buildProductGoalFacts — 머지 조회 실패', () => {
  it('머지 조회를 못 한 회차는 목표 밖 작업을 내지 않는다', () => {
    const unknown = {
      ...contextWith([], ['chore: 의존성 갱신']),
      mergedLookupAvailable: false,
    };
    expect(build([goal()], { context: unknown }).facts).toEqual([]);
  });
});

// 변이 테스트(Stryker)로 드러난 빈틈 — 호출자가 보는 결과(사실·묶음 요약)로 경계값을 고정한다.
describe('buildProductGoalFacts — 경계와 묶음', () => {
  const dueIn = (days: number): Date => new Date(Date.UTC(2026, 9, 8 + days)); // now 의 KST 날짜(2026-10-08) 기준 UTC 자정
  const riskFacts = (dueDate: Date, title = '보존기간 파일 파기') =>
    build([goal({ dueDate, title })], {
      context: contextWith(['보존기간 파기 배치 추가']),
    }).facts.filter((fact) => fact.kind === 'GOAL_DEADLINE_RISK');

  it('목표가 둘이면 작업이 둘 중 하나에만 붙어도 목표 밖이 아니다', () => {
    const result = build(
      [goal(), goal({ id: 2, title: '인증 개편', keywords: ['인증'] })],
      { context: contextWith([], ['feat(file): 보존기간 파기']) },
    );
    expect(result.facts).toEqual([]);
  });

  it('목표 밖 작업이 3건이면 전부 보이고 "외 N건" 은 붙지 않는다', () => {
    const result = build([goal()], {
      context: contextWith([], ['a 작업', 'b 작업', 'c 작업']),
    });
    expect(result.facts[0]).toMatchObject({
      label: '목표 밖 작업 3건',
      detail: 'a 작업 · b 작업 · c 작업',
    });
  });

  it('목표 밖 작업이 4건이면 앞 3건만 보이고 나머지는 "외 N건" 으로 센다', () => {
    const result = build([goal()], {
      context: contextWith([], ['a 작업', 'b 작업', 'c 작업', 'd 작업']),
    });
    expect(result.facts[0]).toMatchObject({
      label: '목표 밖 작업 4건',
      detail: 'a 작업 · b 작업 · c 작업 외 1건',
    });
  });

  it('담당 작업 조회를 못 한 회차는 열린 항목 0건으로 보고 기한 위험을 내지 않는다', () => {
    const result = build([goal({ dueDate: dueIn(3) })], {
      context: { ...contextWith(), assignedTasks: null },
    });
    expect(result.facts).toEqual([]);
  });

  it('기한이 정확히 GOAL_DEADLINE_RISK_DAYS 일 남았으면 기한 위험이다', () => {
    expect(riskFacts(dueIn(GOAL_DEADLINE_RISK_DAYS))).toHaveLength(1);
    expect(riskFacts(dueIn(GOAL_DEADLINE_RISK_DAYS + 1))).toHaveLength(0);
  });

  it('붙은 열린 항목 수는 목표에 붙은 것만 센다', () => {
    const result = build([goal({ dueDate: dueIn(3) })], {
      context: contextWith(['보존기간 파기 배치', '파기 2차', '무관한 작업']),
    });
    expect(result.facts[0]).toMatchObject({
      detail: '기한 D-3 · 붙은 열린 항목 2건',
    });
  });

  it('기한 위험 문구: 초과는 "N일 지남", 당일은 "D-0"', () => {
    expect(riskFacts(dueIn(-2))[0].detail).toBe(
      '기한 2일 지남 · 붙은 열린 항목 1건',
    );
    expect(riskFacts(dueIn(0))[0].detail).toBe('기한 D-0 · 붙은 열린 항목 1건');
  });

  describe('라벨 다듬기', () => {
    it('제목 앞뒤 공백을 떼고 안의 연속 공백·줄바꿈은 한 칸으로 줄인다', () => {
      expect(riskFacts(dueIn(3), '  보존기간   파기\n마무리  ')[0].label).toBe(
        '보존기간 파기 마무리',
      );
    });

    it('30자까지는 그대로, 넘으면 30자 뒤에 …', () => {
      const exact = '가'.repeat(30);
      expect(riskFacts(dueIn(3), exact)[0].label).toBe(exact);
      expect(riskFacts(dueIn(3), `${exact}나`)[0].label).toBe(`${exact}…`);
    });
  });
});
