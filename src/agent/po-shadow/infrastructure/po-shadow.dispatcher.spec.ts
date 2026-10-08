import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { GeneratePoShadowUsecase } from '../application/generate-po-shadow.usecase';
import { ProductGoalRepositoryPort } from '../domain/port/product-goal.repository.port';
import {
  MAX_ACTIVE_PRODUCT_GOALS,
  ProductGoalRecord,
} from '../domain/product-goal';
import { PoShadowDispatcher } from './po-shadow.dispatcher';

const DECLARATION =
  '이번 분기 목표는 보존기간 파일 파기, 달성 기준은 운영 배포 완료, 기한 2026-12-31';

const activeGoal = (id: number, title = `목표 ${id}`): ProductGoalRecord => ({
  id,
  slackUserId: 'U1',
  title,
  successCriterion: '배포 완료',
  keywords: [title],
  dueDate: null,
  closedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
});

describe('PoShadowDispatcher — 제품 목표', () => {
  let repository: {
    findActive: jest.Mock;
    create: jest.Mock;
    close: jest.Mock;
  };
  let createPreview: { execute: jest.Mock };
  let generatePoShadow: { execute: jest.Mock };
  let dispatcher: PoShadowDispatcher;

  beforeEach(() => {
    repository = {
      findActive: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      close: jest.fn(),
    };
    createPreview = {
      execute: jest.fn().mockResolvedValue({ id: 'preview-1' }),
    };
    generatePoShadow = { execute: jest.fn() };
    dispatcher = new PoShadowDispatcher(
      generatePoShadow as unknown as GeneratePoShadowUsecase,
      repository as unknown as ProductGoalRepositoryPort,
      createPreview as unknown as CreatePreviewUsecase,
    );
  });

  const dispatch = (text: string) =>
    dispatcher.dispatch({ source: 'SLACK_MESSAGE', slackUserId: 'U1', text });

  // 정책 1 — 이대리는 목표를 저장하지 않는다. 확인 카드만 만든다.
  it('선언은 저장하지 않고 확인 카드를 만든다', async () => {
    const outcome = await dispatch(DECLARATION);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.close).not.toHaveBeenCalled();
    expect(createPreview.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        kind: PREVIEW_KIND.PRODUCT_GOAL,
        payload: {
          action: 'CREATE',
          draft: {
            title: '보존기간 파일 파기',
            successCriterion: '운영 배포 완료',
            keywords: ['보존기간', '파일', '파기'],
            dueDate: '2026-12-31',
          },
        },
      }),
    );
    expect(outcome.preview?.id).toBe('preview-1');
    expect(outcome.formattedText).toContain('이렇게 저장할까요?');
    expect(generatePoShadow.execute).not.toHaveBeenCalled();
  });

  // 정책 3 — 달성 기준 없는 목표는 카드도 만들지 않고 되묻는다.
  it.each([
    ['이번 분기 목표는 업로드 안정화', '달성 기준이 없어'],
    [
      '이번 분기 목표는 업로드 안정화, 달성 기준은 개선하기',
      '끝을 판정할 수 없어',
    ],
  ])('%s → 되묻는다', async (text, expected) => {
    const outcome = await dispatch(text);
    expect(createPreview.execute).not.toHaveBeenCalled();
    expect(outcome.preview).toBeUndefined();
    expect(outcome.formattedText).toContain(expected);
  });

  // 정책 4 — 4번째 선언은 카드 없이 닫을 목표를 묻는다.
  it('활성 목표가 상한이면 카드 없이 기존 목표를 보여 준다', async () => {
    repository.findActive.mockResolvedValue(
      Array.from({ length: MAX_ACTIVE_PRODUCT_GOALS }, (_, index) =>
        activeGoal(index + 1),
      ),
    );
    const outcome = await dispatch(DECLARATION);
    expect(createPreview.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('하나를 닫을까요?');
    expect(outcome.formattedText).toContain('목표 1');
  });

  it('질문형 선언은 카드를 만들지 않는다', async () => {
    const outcome = await dispatch(`${DECLARATION} 이렇게 저장해도 될까?`);
    expect(createPreview.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('질문으로 보여서');
  });

  it('닫기는 맞는 목표 하나에 대해서만 확인 카드를 만든다', async () => {
    repository.findActive.mockResolvedValue([
      activeGoal(4, '업로드 안정화'),
      activeGoal(5, '보존기간 파일 파기'),
    ]);
    await dispatch('업로드 안정화 목표 닫아줘');
    expect(repository.close).not.toHaveBeenCalled();
    expect(createPreview.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { action: 'CLOSE', goalId: 4, title: '업로드 안정화' },
      }),
    );
  });

  it('맞는 목표가 없으면 활성 목록을 보여 준다', async () => {
    repository.findActive.mockResolvedValue([activeGoal(4, '업로드 안정화')]);
    const outcome = await dispatch('결제 목표 닫아줘');
    expect(createPreview.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('맞는 활성 목표가 없어요');
  });

  it('목표 보여줘 는 활성 목표를 나열한다', async () => {
    repository.findActive.mockResolvedValue([activeGoal(4, '업로드 안정화')]);
    const outcome = await dispatch('목표 보여줘');
    expect(outcome.agentRunId).toBe(0);
    expect(outcome.formattedText).toContain('활성 제품 목표 1/3');
    expect(outcome.formattedText).toContain('업로드 안정화');
  });

  it('목표 문장이 아니면 지금처럼 PO 검토로 넘긴다', async () => {
    generatePoShadow.execute.mockResolvedValue({
      agentRunId: 11,
      modelUsed: 'deterministic',
      result: {
        schemaVersion: 2,
        quiet: true,
        headline: '계획대로 진행 중',
        findings: [],
        judgments: [],
        factSummary: [],
        droppedFindingCount: 0,
        degradedSources: [],
        recoverySummary: null,
      },
    });
    const outcome = await dispatch('  릴리즈 오늘로 변경  ');
    expect(generatePoShadow.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      extraContext: '릴리즈 오늘로 변경',
    });
    expect(repository.findActive).not.toHaveBeenCalled();
    expect(outcome.agentRunId).toBe(11);
  });
});
