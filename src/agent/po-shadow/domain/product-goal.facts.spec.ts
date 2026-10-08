import { PoShadowContext } from './po-shadow.type';
import { ProductGoalRecord, STALE_GOAL_DAYS } from './product-goal';
import {
  buildProductGoalFacts,
  collectLastProgressAt,
} from './product-goal.facts';

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
  failedRunsToday: [],
  degradedSources: [],
});

const goal = (
  overrides: Partial<ProductGoalRecord> = {},
): ProductGoalRecord => ({
  id: 1,
  slackUserId: 'U1',
  title: '보존기간 파일 파기',
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
    lastProgressAtByGoalId = new Map<number, Date>(),
  }: {
    context?: PoShadowContext;
    lastProgressAtByGoalId?: Map<number, Date>;
  } = {},
) => buildProductGoalFacts({ goals, context, lastProgressAtByGoalId, now });

describe('buildProductGoalFacts', () => {
  it('활성 목표가 없으면 아무것도 만들지 않는다', () => {
    expect(build([])).toEqual({
      facts: [],
      progressedGoalIds: [],
      checkIns: [],
    });
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
    expect(result.progressedGoalIds).toEqual([1]);
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
    });
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
    ).toEqual({ facts: [], progressedGoalIds: [], checkIns: [] });
  });

  // 정책 5 — 묵은 목표를 다시 묻는다.
  describe('묵은 목표 질문', () => {
    // 오늘 머지는 있지만 목표에 붙지 않은 회차.
    const idle = contextWith([], ['fix: 무관한 수정']);

    it('기한이 지났으면 묻는다', () => {
      const result = build(
        [goal({ dueDate: new Date('2026-10-05T00:00:00Z') })],
        { context: idle },
      );
      expect(result.checkIns).toEqual([
        '"보존기간 파일 파기" — 기한 3일 지남. 이 목표 아직 유효한가요?',
      ]);
    });

    it(`${STALE_GOAL_DAYS}일 넘게 붙은 진행이 없으면 묻는다`, () => {
      const result = build(
        [goal({ createdAt: new Date(now.getTime() - 60 * DAY) })],
        {
          context: idle,
          lastProgressAtByGoalId: new Map([
            [1, new Date(now.getTime() - STALE_GOAL_DAYS * DAY - 60_000)],
          ]),
        },
      );
      expect(result.checkIns).toEqual([
        `"보존기간 파일 파기" — ${STALE_GOAL_DAYS}일 넘게 붙은 진행 없음. 이 목표 아직 유효한가요?`,
      ]);
    });

    it('마지막 진행이 기준일을 넘지 않았으면 묻지 않는다', () => {
      const result = build(
        [goal({ createdAt: new Date(now.getTime() - 60 * DAY) })],
        {
          context: idle,
          lastProgressAtByGoalId: new Map([
            // 정확히 기준일째 — "넘게" 가 아니다.
            [1, new Date(now.getTime() - STALE_GOAL_DAYS * DAY)],
          ]),
        },
      );
      expect(result.checkIns).toEqual([]);
    });

    it('진행 기록이 없어도 만든 지 기준일이 안 됐으면 묻지 않는다', () => {
      expect(build([goal()], { context: idle }).checkIns).toEqual([]);
    });

    it('오늘 진행이 있으면 오래된 목표라도 묻지 않는다', () => {
      const result = build([
        goal({ createdAt: new Date(now.getTime() - 60 * DAY) }),
      ]);
      expect(result.checkIns).toEqual([]);
    });
  });
});

// 진행은 머지로만 센다 — 계획에 실렸거나 열려 있는 것은 움직였다는 근거가 아니다(#773 리뷰).
describe('buildProductGoalFacts — 진행 근거', () => {
  const oldGoal = goal({ createdAt: new Date(now.getTime() - 40 * DAY) });

  it('계획·담당 목록에만 오르고 머지되지 않은 키워드 항목은 진행이 아니다', () => {
    const result = build([oldGoal], {
      context: contextWith(['보존기간 파기 배치 추가'], []),
    });
    expect(result.progressedGoalIds).toEqual([]);
    expect(result.checkIns).toEqual([
      `"보존기간 파일 파기" — ${STALE_GOAL_DAYS}일 넘게 붙은 진행 없음. 이 목표 아직 유효한가요?`,
    ]);
  });

  it('대조군 — 목표에 붙은 PR 이 머지되면 진행이다', () => {
    const result = build([oldGoal]);
    expect(result.progressedGoalIds).toEqual([1]);
    expect(result.checkIns).toEqual([]);
  });

  it('머지 조회를 못 한 회차는 목표 밖 작업·무진행 질문을 내지 않는다', () => {
    const unknown = {
      ...contextWith([], ['chore: 의존성 갱신']),
      mergedLookupAvailable: false,
    };
    const result = build([oldGoal], { context: unknown });
    expect(result.facts).toEqual([]);
    expect(result.checkIns).toEqual([]);
  });

  it('머지 조회를 못 해도 기한 경과는 묻는다', () => {
    const overdue = goal({ dueDate: new Date('2026-10-05T00:00:00Z') });
    const result = build([overdue], {
      context: { ...contextWith(), mergedLookupAvailable: false },
    });
    expect(result.checkIns).toHaveLength(1);
  });
});

describe('collectLastProgressAt', () => {
  it('목표별 가장 최근 진행 회차를 고르고 형태가 다른 값은 건너뛴다', () => {
    const older = new Date('2026-09-20T00:00:00Z');
    const newer = new Date('2026-10-01T00:00:00Z');
    const result = collectLastProgressAt([
      { inputSnapshot: { goalProgress: [1, 2] }, endedAt: older },
      { inputSnapshot: { goalProgress: [1] }, endedAt: newer },
      { inputSnapshot: { goalProgress: ['x'] }, endedAt: newer },
      { inputSnapshot: null, endedAt: newer },
    ]);
    expect(result).toEqual(
      new Map([
        [1, newer],
        [2, older],
      ]),
    );
  });
});
