import { planGoalCheckin } from './goal-checkin';
import { GoalQuestionRecord } from './port/goal-question.repository.port';
import { ProductGoalRecord } from './product-goal';

// KST 2026-11-02(월) 09:15
const now = new Date('2026-11-02T00:15:00.000Z');
const DAY = 86_400_000;

const goal = (
  overrides: Partial<ProductGoalRecord> = {},
): ProductGoalRecord => ({
  id: 1,
  slackUserId: 'U1',
  kind: 'TASK',
  title: '오피스 화면에 오늘 일정 띄우기',
  why: null,
  successCriterion: '오피스 화면에 일정이 보인다',
  keywords: ['오피스', 'office'],
  dueDate: null,
  closedAt: null,
  createdAt: new Date(now.getTime() - 30 * DAY),
  ...overrides,
});

const direction = (overrides: Partial<ProductGoalRecord> = {}) =>
  goal({
    id: 83,
    kind: 'DIRECTION',
    title: '이직하기',
    successCriterion: null,
    keywords: [],
    ...overrides,
  });

const question = (
  overrides: Partial<GoalQuestionRecord> = {},
): GoalQuestionRecord => ({
  id: 1,
  slackUserId: 'U1',
  expiresAt: new Date(now.getTime() - 4 * DAY),
  previewId: null,
  criterionAskedAt: null,
  pendingDraft: null,
  closedAt: null,
  closeReason: null,
  createdAt: new Date(now.getTime() - 7 * DAY),
  ...overrides,
});

const merged = (number: number, title: string, daysAgo: number) => ({
  number,
  title,
  mergedAt: new Date(now.getTime() - daysAgo * DAY).toISOString(),
});

const plan = (input: Partial<Parameters<typeof planGoalCheckin>[0]> = {}) =>
  planGoalCheckin({
    goals: [],
    mergedPullRequests: [],
    openQuestion: null,
    recentQuestions: [],
    now,
    ...input,
  });

describe('planGoalCheckin', () => {
  describe('목표가 없을 때', () => {
    it('목표를 묻는다', () => {
      expect(plan()).toEqual({ kind: 'ASK_FOR_GOALS' });
    });

    it('열린 질문이 있으면 겹쳐 묻지 않는다', () => {
      expect(plan({ openQuestion: question() })).toEqual({ kind: 'SKIP' });
    });

    it('두 번 연달아 답이 없으면 쉰다', () => {
      const recentQuestions = [
        question({ id: 2, createdAt: new Date(now.getTime() - 7 * DAY) }),
        question({ id: 1, createdAt: new Date(now.getTime() - 14 * DAY) }),
      ];
      expect(plan({ recentQuestions })).toEqual({ kind: 'SKIP' });
    });

    it('쉬는 기간이 지나면 다시 묻는다', () => {
      const recentQuestions = [
        question({ id: 2, createdAt: new Date(now.getTime() - 35 * DAY) }),
        question({ id: 1, createdAt: new Date(now.getTime() - 42 * DAY) }),
      ];
      expect(plan({ recentQuestions })).toEqual({ kind: 'ASK_FOR_GOALS' });
    });

    // 질문 행은 발송이 끝난 뒤 찍혀 5주 뒤 점검 시각보다 몇 초 늦다 — 그 차이로 한 주 더 쉬면 안 된다.
    it('5주 뒤 월요일에는 질문 행이 몇 초 늦게 찍혔어도 다시 묻는다', () => {
      const recentQuestions = [
        question({
          id: 2,
          createdAt: new Date(now.getTime() - 35 * DAY + 20_000),
        }),
        question({ id: 1, createdAt: new Date(now.getTime() - 42 * DAY) }),
      ];
      expect(plan({ recentQuestions })).toEqual({ kind: 'ASK_FOR_GOALS' });
    });

    it('4주 뒤 월요일에는 아직 쉰다', () => {
      const recentQuestions = [
        question({ id: 2, createdAt: new Date(now.getTime() - 28 * DAY) }),
        question({ id: 1, createdAt: new Date(now.getTime() - 35 * DAY) }),
      ];
      expect(plan({ recentQuestions })).toEqual({ kind: 'SKIP' });
    });

    it('대조군 — 둘 중 하나라도 답했으면 쉬지 않는다', () => {
      const recentQuestions = [
        question({ id: 2 }),
        question({ id: 1, closeReason: 'DECLINED' }),
      ];
      expect(plan({ recentQuestions })).toEqual({ kind: 'ASK_FOR_GOALS' });
    });
  });

  // #902 이 넘긴 몫 — 키워드 없는 방향 목표는 일일 PO 판정에서 빠지므로 여기서 묻는다.
  describe('방향 목표', () => {
    it('기한이 지난 방향 목표는 "아직 유효한가요?" 로 묻는다', () => {
      const result = plan({
        goals: [direction({ dueDate: new Date('2026-10-31T00:00:00.000Z') })],
      });
      expect(result).toMatchObject({
        kind: 'CHECKIN',
        staleGoals: [
          {
            goal: { id: 83 },
            reason: { kind: 'OVERDUE', daysOverdue: 2 },
          },
        ],
        directions: [],
      });
    });

    it('숙제가 없으면 가장 최근 방향에 끌어내기 질문을 붙인다', () => {
      const older = direction({
        id: 10,
        createdAt: new Date(now.getTime() - 60 * DAY),
      });
      const newer = direction({ id: 11, title: '나만의 개인비서 만들기' });
      const result = plan({ goals: [older, newer] });
      expect(result).toMatchObject({
        kind: 'CHECKIN',
        drawOutDirection: { id: 11 },
      });
    });

    it('숙제가 있으면 끌어내기 질문을 붙이지 않는다', () => {
      const result = plan({ goals: [direction(), goal()] });
      expect(result).toMatchObject({ drawOutDirection: null });
    });

    it('끌어내기도 쉬기 규칙을 따른다', () => {
      const recentQuestions = [question({ id: 2 }), question({ id: 1 })];
      const result = plan({ goals: [direction()], recentQuestions });
      expect(result).toMatchObject({
        drawOutDirection: null,
        directions: [{ id: 83 }],
      });
    });
  });

  describe('숙제 목표', () => {
    it('지난 7일 붙은 머지 PR 번호와 기한을 보여 준다', () => {
      const result = plan({
        goals: [goal({ dueDate: new Date('2026-11-15T00:00:00.000Z') })],
        mergedPullRequests: [
          merged(880, 'feat(office): 일정 카드', 3),
          merged(870, 'feat(office): 레이아웃', 10),
          merged(881, 'fix(auth): 토큰', 2),
        ],
      });
      expect(result).toMatchObject({
        kind: 'CHECKIN',
        tasks: [{ recentPullRequestNumbers: [880], daysLeft: 13 }],
        staleGoals: [],
      });
    });

    it('2주 동안 붙은 작업이 없으면 잊은 목표로 묻는다', () => {
      const result = plan({
        goals: [goal()],
        mergedPullRequests: [merged(881, 'fix(auth): 토큰', 2)],
      });
      expect(result).toMatchObject({
        tasks: [],
        staleGoals: [{ reason: { kind: 'FORGOTTEN' } }],
      });
    });

    it('만든 지 2주가 안 된 목표는 아직 잊었다고 하지 않는다', () => {
      const result = plan({
        goals: [goal({ createdAt: new Date(now.getTime() - 5 * DAY) })],
      });
      expect(result).toMatchObject({
        staleGoals: [],
        tasks: [{ goal: { id: 1 } }],
      });
    });

    it('머지 조회를 못 했으면 잊었다고 판정하지 않는다', () => {
      const result = plan({ goals: [goal()], mergedPullRequests: null });
      expect(result).toMatchObject({
        staleGoals: [],
        mergedLookupAvailable: false,
        tasks: [{ recentPullRequestNumbers: [] }],
      });
    });

    it('기한이 지난 숙제는 잊은 목표보다 기한 경과로 묻는다', () => {
      const result = plan({
        goals: [goal({ dueDate: new Date('2026-10-30T00:00:00.000Z') })],
      });
      expect(result).toMatchObject({
        staleGoals: [{ reason: { kind: 'OVERDUE', daysOverdue: 3 } }],
      });
    });
  });
});
