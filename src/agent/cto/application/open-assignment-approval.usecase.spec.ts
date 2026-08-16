import { AgentType } from '../../../model-router/domain/model-router.type';
import { CancelPreviewUsecase } from '../../../preview-gate/application/cancel-preview.usecase';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { AssignmentOutput, CtoBeChainPayload } from '../domain/cto.type';
import { OpenAssignmentApprovalUsecase } from './open-assignment-approval.usecase';

const output: AssignmentOutput = {
  assignments: [
    {
      taskId: 't:1',
      taskTitle: 'Router 마무리',
      beAssignment: AgentType.BE,
      priority: 1,
      reasoning: 'BE 진입 worker',
      confidence: 0.9,
    },
  ],
  unassignedTasks: [],
  ctoSummary: '1건 분배',
};

const openPreview = (overrides: Partial<PreviewAction> = {}): PreviewAction =>
  ({
    id: overrides.id ?? 'p-old',
    slackUserId: overrides.slackUserId ?? 'U1',
    kind: overrides.kind ?? PREVIEW_KIND.CTO_BE_CHAIN,
    payload: {},
    status: 'PENDING',
    previewText: '',
    responseUrl: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    appliedAt: null,
    cancelledAt: null,
    slackChannelId: null,
    slackMessageTs: null,
  }) as PreviewAction;

describe('OpenAssignmentApprovalUsecase', () => {
  let createExecute: jest.Mock;
  let cancelExecute: jest.Mock;
  let findAllOpenExecute: jest.Mock;
  let usecase: OpenAssignmentApprovalUsecase;

  beforeEach(() => {
    createExecute = jest.fn().mockResolvedValue({ id: 'p-new' });
    cancelExecute = jest.fn().mockResolvedValue(undefined);
    findAllOpenExecute = jest.fn().mockResolvedValue([]);
    usecase = new OpenAssignmentApprovalUsecase(
      { execute: createExecute } as unknown as CreatePreviewUsecase,
      { execute: cancelExecute } as unknown as CancelPreviewUsecase,
      { execute: findAllOpenExecute } as unknown as FindAllOpenPreviewsUsecase,
    );
  });

  // 호출자가 이 id 로 드롭다운·실행 버튼이 달린 카드를 그린다.
  it('분배가 있으면 CTO_BE_CHAIN preview 를 열고 previewId 반환', async () => {
    const previewId = await usecase.execute({
      slackUserId: 'U1',
      ctoAgentRunId: 42,
      output,
    });

    expect(previewId).toBe('p-new');
    expect(createExecute).toHaveBeenCalledTimes(1);
    const input = createExecute.mock.calls[0][0];
    expect(input.kind).toBe(PREVIEW_KIND.CTO_BE_CHAIN);
    expect(input.slackUserId).toBe('U1');
  });

  it('payload 에 실행 정보 + 카드 재렌더용 표시 정보를 함께 싣는다', async () => {
    await usecase.execute({ slackUserId: 'U1', ctoAgentRunId: 42, output });

    const payload = createExecute.mock.calls[0][0].payload as CtoBeChainPayload;
    expect(payload).toEqual({
      ctoAgentRunId: 42,
      slackUserId: 'U1',
      assignments: output.assignments,
      ctoSummary: output.ctoSummary,
      unassignedTasks: output.unassignedTasks,
    });
  });

  // 실행할 게 없는데 실행 버튼을 띄우면 눌러도 아무 일이 안 일어난다.
  it('분배가 0건이면 카드를 열지 않고 null 반환', async () => {
    const previewId = await usecase.execute({
      slackUserId: 'U1',
      ctoAgentRunId: 42,
      output: { ...output, assignments: [] },
    });

    expect(previewId).toBeNull();
    expect(createExecute).not.toHaveBeenCalled();
  });

  // 재배정 때마다 카드가 쌓이면, 최신 카드를 "아니" 로 닫는 순간 옛 분배 카드가 최신
  // PENDING 이 되어 그 다음 "응" 에 이미 버린 분배가 실행된다.
  it('같은 사용자의 열린 분배 카드는 새 카드를 열기 전에 취소', async () => {
    findAllOpenExecute.mockResolvedValue([
      openPreview({ id: 'p-old-1' }),
      openPreview({ id: 'p-old-2' }),
    ]);

    await usecase.execute({ slackUserId: 'U1', ctoAgentRunId: 43, output });

    expect(cancelExecute).toHaveBeenCalledTimes(2);
    expect(cancelExecute).toHaveBeenCalledWith({
      previewId: 'p-old-1',
      slackUserId: 'U1',
    });
    expect(cancelExecute).toHaveBeenCalledWith({
      previewId: 'p-old-2',
      slackUserId: 'U1',
    });
  });

  it('다른 사용자 카드 / 다른 kind 카드는 건드리지 않는다', async () => {
    findAllOpenExecute.mockResolvedValue([
      openPreview({ id: 'p-other-user', slackUserId: 'U2' }),
      openPreview({ id: 'p-other-kind', kind: PREVIEW_KIND.PM_WRITE_BACK }),
    ]);

    await usecase.execute({ slackUserId: 'U1', ctoAgentRunId: 43, output });

    expect(cancelExecute).not.toHaveBeenCalled();
    expect(createExecute).toHaveBeenCalledTimes(1);
  });

  // 정리 실패가 새 분배 자체를 막을 이유는 없다 — 새 카드가 최신이라 승인 흐름은 정상이다.
  it('이전 카드 정리가 실패해도 새 카드는 연다', async () => {
    findAllOpenExecute.mockRejectedValue(new Error('db down'));

    const previewId = await usecase.execute({
      slackUserId: 'U1',
      ctoAgentRunId: 43,
      output,
    });

    expect(previewId).toBe('p-new');
    expect(createExecute).toHaveBeenCalledTimes(1);
  });
});
