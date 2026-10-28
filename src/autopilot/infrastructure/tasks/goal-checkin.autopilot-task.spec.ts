import { ProductGoalRecord } from '../../../agent/po-shadow/domain/product-goal';
import { GoalCheckinAutopilotTask } from './goal-checkin.autopilot-task';

// KST 2026-11-02(월) 09:15
const now = new Date('2026-11-02T00:15:00.000Z');
const DAY = 86_400_000;

const direction: ProductGoalRecord = {
  id: 83,
  slackUserId: 'U1',
  kind: 'DIRECTION',
  title: '이직하기',
  why: null,
  successCriterion: null,
  keywords: [],
  dueDate: new Date('2026-10-31T00:00:00.000Z'),
  closedAt: null,
  createdAt: new Date(now.getTime() - 30 * DAY),
};

const makeTask = ({ author = 'jsl107' }: { author?: string } = {}) => {
  const goals = { findActive: jest.fn().mockResolvedValue([]) };
  const questions = {
    findOpen: jest.fn().mockResolvedValue(null),
    findRecent: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(undefined),
  };
  const github = {
    listAuthorMergedPullRequestsSince: jest.fn().mockResolvedValue([]),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'IMPACT_REPORT_GITHUB_AUTHOR' ? author : undefined,
    ),
  };
  const task = new GoalCheckinAutopilotTask(
    goals as never,
    questions as never,
    github as never,
    config as never,
  );
  return { task, goals, questions, github };
};

describe('GoalCheckinAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-11-02' };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('목표가 없으면 묻고, 발송된 뒤에만 72시간 표지를 만든다', async () => {
    const { task, questions, github } = makeTask();

    const result = await task.run(context);

    expect(result.summaryText).toContain('머릿속에 있는 목표');
    expect(github.listAuthorMergedPullRequestsSince).not.toHaveBeenCalled();
    expect(questions.create).not.toHaveBeenCalled();
    await result.onDelivered?.();
    expect(questions.create).toHaveBeenCalledWith({
      slackUserId: 'U1',
      expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1000),
    });
  });

  it('열린 질문이 있으면 건너뛴다', async () => {
    const { task, questions } = makeTask();
    questions.findOpen.mockResolvedValue({ id: 1 });

    expect(await task.run(context)).toEqual({ skip: true });
  });

  it('기한 지난 방향 목표는 점검에 싣고 [닫기] 카드를 단다', async () => {
    const { task, goals } = makeTask();
    goals.findActive.mockResolvedValue([direction]);

    const result = await task.run(context);

    expect(result.summaryText).toContain('⏰ *이직하기* — 기한 2일 지남');
    expect(result.previews).toEqual([
      expect.objectContaining({
        kind: 'PRODUCT_GOAL',
        payload: { action: 'CLOSE', goalId: 83, title: '이직하기' },
      }),
    ]);
    // 끌어내기 대상이 될 방향이 남지 않았으니 질문 표지도 없다.
    expect(result.onDelivered).toBeUndefined();
  });

  it('숙제 없이 방향만 있으면 끌어내기 질문을 붙이고 표지를 만든다', async () => {
    const { task, goals, questions, github } = makeTask();
    goals.findActive.mockResolvedValue([{ ...direction, dueDate: null }]);

    const result = await task.run(context);

    expect(result.summaryText).toContain('꼭 되게 하고 싶은 일');
    // 방향만 있으면 머지 이력이 필요 없다.
    expect(github.listAuthorMergedPullRequestsSince).not.toHaveBeenCalled();
    expect(result.summaryText).not.toContain('머지 기록을 못 읽어');
    expect(result.previews).toEqual([]);
    await result.onDelivered?.();
    expect(questions.create).toHaveBeenCalled();
  });

  it('GitHub author 가 없으면 관련 작업을 비우고 그 사실을 밝힌다', async () => {
    const { task, goals, github } = makeTask({ author: '' });
    goals.findActive.mockResolvedValue([
      {
        ...direction,
        id: 1,
        kind: 'TASK',
        title: '오피스 일정',
        successCriterion: '보인다',
        keywords: ['office'],
        dueDate: null,
      },
    ]);

    const result = await task.run(context);

    expect(github.listAuthorMergedPullRequestsSince).not.toHaveBeenCalled();
    expect(result.summaryText).toContain('머지 기록을 못 읽어');
    expect(result.previews).toEqual([]);
  });

  it('머지 조회는 2주 창으로 한다', async () => {
    const { task, goals, github } = makeTask();
    goals.findActive.mockResolvedValue([
      { ...direction, kind: 'TASK', keywords: ['office'], dueDate: null },
    ]);

    await task.run(context);

    expect(github.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      expect.objectContaining({
        author: 'jsl107',
        sinceIsoDate: new Date(now.getTime() - 14 * DAY).toISOString(),
        throwOnDetailFailure: true,
      }),
    );
  });
});
