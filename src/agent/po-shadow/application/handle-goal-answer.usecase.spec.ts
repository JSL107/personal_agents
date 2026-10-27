import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CancelPreviewUsecase } from '../../../preview-gate/application/cancel-preview.usecase';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PreviewActionRepositoryPort } from '../../../preview-gate/domain/port/preview-action.repository.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import {
  GoalQuestionRecord,
  GoalQuestionRepositoryPort,
} from '../domain/port/goal-question.repository.port';
import { ProductGoalRepositoryPort } from '../domain/port/product-goal.repository.port';
import { HandleGoalAnswerUsecase } from './handle-goal-answer.usecase';

const NOW = new Date('2026-10-27T00:00:00.000Z');
const DIRECTION = {
  kind: 'DIRECTION',
  title: '나만의 개인비서 만들기',
  why: null,
  successCriterion: null,
  keywords: [],
  dueDate: null,
};
const TASK = {
  kind: 'TASK',
  title: '오피스 일정 표시',
  why: null,
  successCriterion: '일정을 표시하기',
  keywords: ['오피스'],
  dueDate: null,
};

const buildQuestion = (
  overrides: Partial<GoalQuestionRecord> = {},
): GoalQuestionRecord => ({
  id: 1,
  slackUserId: 'U1',
  expiresAt: new Date(NOW.getTime() + 1000),
  previewId: null,
  criterionAskedAt: null,
  pendingDraft: null,
  closedAt: null,
  closeReason: null,
  createdAt: NOW,
  ...overrides,
});

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'old',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PRODUCT_GOAL,
  payload: { action: 'CREATE', draft: DIRECTION },
  status: PREVIEW_STATUS.PENDING,
  previewText: 'old',
  expiresAt: new Date(NOW.getTime() + 1000),
  createdAt: NOW,
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
  ...overrides,
});

const setup = () => {
  const questions = {
    findOpen: jest.fn().mockResolvedValue(buildQuestion()),
    close: jest.fn().mockResolvedValue(undefined),
    markCriterionAsked: jest.fn().mockResolvedValue(undefined),
    attachPreview: jest.fn().mockResolvedValue(undefined),
  };
  const goals = { findActive: jest.fn().mockResolvedValue([]) };
  const previews = { findById: jest.fn().mockResolvedValue(null) };
  const createPreview = { execute: jest.fn().mockResolvedValue({ id: 'new' }) };
  const cancelPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const modelRouter = { route: jest.fn() };
  const usecase = new HandleGoalAnswerUsecase(
    questions as unknown as GoalQuestionRepositoryPort,
    goals as unknown as ProductGoalRepositoryPort,
    previews as unknown as PreviewActionRepositoryPort,
    createPreview as unknown as CreatePreviewUsecase,
    cancelPreview as unknown as CancelPreviewUsecase,
    modelRouter as unknown as ModelRouterUsecase,
  );
  const answer = (
    intent: string,
    goal: unknown,
    otherGoalTitles: string[] = [],
  ) => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({ intent, goal, otherGoalTitles }),
    });
  };
  const execute = (text = '나만의 개인비서 만들기') =>
    usecase.execute({ slackUserId: 'U1', text, now: NOW });
  return {
    questions,
    goals,
    previews,
    createPreview,
    cancelPreview,
    modelRouter,
    usecase,
    answer,
    execute,
  };
};

describe('HandleGoalAnswerUsecase', () => {
  it('방향 답을 확인 카드로 만들고 표지에 연결한다', async () => {
    const fixture = setup();
    fixture.answer('GOAL', DIRECTION, ['오피스 고도화']);
    const result = await fixture.execute();
    expect(result?.previewId).toBe('new');
    expect(result?.replyText).toContain('오피스 고도화');
    expect(fixture.createPreview.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: PREVIEW_KIND.PRODUCT_GOAL,
        payload: {
          action: 'CREATE',
          draft: DIRECTION,
          origin: 'GOAL_QUESTION',
        },
      }),
    );
    expect(fixture.questions.attachPreview).toHaveBeenCalledWith({
      id: 1,
      previewId: 'new',
    });
  });

  it('숫자·완료 낱말이 없어도 기준이 있으면 되묻지 않고 숙제 카드를 만든다', async () => {
    const fixture = setup();
    const job = {
      ...TASK,
      title: '이직하기',
      successCriterion: '실제로 회사를 옮겨 새 직장에서 근무를 시작한다',
      keywords: ['이직'],
    };
    fixture.answer('GOAL', job);
    const result = await fixture.execute('이직하기');
    expect(fixture.questions.markCriterionAsked).not.toHaveBeenCalled();
    expect(result?.previewId).toBe('new');
    expect(
      fixture.createPreview.execute.mock.calls[0][0].payload.draft.kind,
    ).toBe('TASK');
  });

  it('숙제 기준이 비면 한 번 묻고 다시 비면 방향 카드로 제안한다', async () => {
    const fixture = setup();
    const vague = { ...TASK, successCriterion: null };
    fixture.answer('GOAL', vague);
    const first = await fixture.execute('오피스 일정 표시');
    expect(first?.replyText).toContain('끝난 건 어떻게');
    expect(fixture.questions.markCriterionAsked).toHaveBeenCalledWith({
      id: 1,
      at: NOW,
      pendingDraft: vague,
    });
    fixture.questions.findOpen.mockResolvedValue(
      buildQuestion({ criterionAskedAt: NOW, pendingDraft: vague }),
    );
    const second = await fixture.execute('아직 잘 모르겠어요');
    expect(second?.previewId).toBe('new');
    expect(second?.replyText).toContain('방향으로 제안');
    expect(
      fixture.createPreview.execute.mock.calls[0][0].payload.draft.kind,
    ).toBe('DIRECTION');
  });

  it('무관한 답은 표지를 유지하며 라우터로 넘긴다', async () => {
    const fixture = setup();
    fixture.answer('NOT_A_GOAL', null);
    expect(await fixture.execute('오늘 일정 알려줘')).toBeNull();
    expect(fixture.questions.close).not.toHaveBeenCalled();
  });

  it('무관한 답에 모델이 덤 칸을 채워도 재요청 없이 라우터로 넘긴다', async () => {
    const fixture = setup();
    fixture.answer('NOT_A_GOAL', DIRECTION, ['블로그']);
    expect(await fixture.execute('오늘 일정 알려줘')).toBeNull();
  });

  it('방향 카드에는 모델이 채운 키워드를 싣지 않는다', async () => {
    const fixture = setup();
    fixture.answer('GOAL', { ...DIRECTION, keywords: ['비서', 'assistant'] });
    await fixture.execute();
    expect(fixture.createPreview.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          draft: expect.objectContaining({ kind: 'DIRECTION', keywords: [] }),
        }),
      }),
    );
  });

  it('거절하면 표지를 닫는다', async () => {
    const fixture = setup();
    fixture.answer('DECLINE', null);
    expect((await fixture.execute('나중에'))?.replyText).toContain('다음 주');
    expect(fixture.questions.close).toHaveBeenCalledWith({
      id: 1,
      reason: 'DECLINED',
      at: NOW,
    });
  });

  it('기존 목표 명령은 모델을 호출하지 않는다', async () => {
    const fixture = setup();
    expect(await fixture.execute('목표 보여줘')).toBeNull();
    expect(fixture.modelRouter.route).not.toHaveBeenCalled();
  });

  it('PENDING 카드 수정은 이전 카드를 취소하고 새 카드를 만든다', async () => {
    const fixture = setup();
    fixture.questions.findOpen.mockResolvedValue(
      buildQuestion({ previewId: 'old' }),
    );
    fixture.previews.findById.mockResolvedValue(buildPreview());
    fixture.answer('GOAL', { ...DIRECTION, title: '수정된 목표' });
    expect((await fixture.execute('제목을 수정된 목표로'))?.previewId).toBe(
      'new',
    );
    expect(fixture.cancelPreview.execute).toHaveBeenCalledWith({
      previewId: 'old',
      slackUserId: 'U1',
    });
  });

  it('이미 적용된 카드면 표지를 닫고 라우터로 넘긴다', async () => {
    const fixture = setup();
    fixture.questions.findOpen.mockResolvedValue(
      buildQuestion({ previewId: 'old' }),
    );
    fixture.previews.findById.mockResolvedValue(
      buildPreview({ status: PREVIEW_STATUS.APPLIED }),
    );
    expect(await fixture.execute('다음 목표')).toBeNull();
    expect(fixture.questions.close).toHaveBeenCalledWith({
      id: 1,
      reason: 'CARD_RESOLVED',
      at: NOW,
    });
  });

  it('종류별 상한에 닿으면 카드를 만들지 않고 표지를 닫는다', async () => {
    const fixture = setup();
    fixture.answer('GOAL', DIRECTION);
    fixture.goals.findActive.mockResolvedValue([
      { ...DIRECTION, id: 1, title: '첫 번째 방향' },
      { ...DIRECTION, id: 2, title: '다른 방향' },
    ]);
    expect((await fixture.execute())?.replyText).toContain('방향');
    expect(fixture.questions.close).toHaveBeenCalledWith({
      id: 1,
      reason: 'LIMIT_REACHED',
      at: NOW,
    });
    expect(fixture.createPreview.execute).not.toHaveBeenCalled();
  });

  it('모델 실패와 잘못된 kind는 재요청하고 표지를 유지한다', async () => {
    const fixture = setup();
    fixture.modelRouter.route.mockRejectedValueOnce(
      new Error('model unavailable'),
    );
    expect((await fixture.execute())?.replyText).toContain('다시 말해');
    fixture.answer('GOAL', { ...DIRECTION, kind: 'OTHER' });
    expect((await fixture.execute())?.replyText).toContain('다시 말해');
    expect(fixture.questions.close).not.toHaveBeenCalled();
  });

  it('열린 표지가 없으면 모델을 호출하지 않는다', async () => {
    const fixture = setup();
    fixture.questions.findOpen.mockResolvedValue(null);
    expect(await fixture.execute()).toBeNull();
    expect(fixture.modelRouter.route).not.toHaveBeenCalled();
  });
});
