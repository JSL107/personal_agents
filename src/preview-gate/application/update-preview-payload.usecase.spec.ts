import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
  PreviewStatus,
} from '../domain/preview-action.type';
import { ApplyPreviewUsecase } from './apply-preview.usecase';
import { UpdatePreviewPayloadUsecase } from './update-preview-payload.usecase';

const buildPreview = (overrides: Partial<PreviewAction> = {}): PreviewAction =>
  ({
    id: 'p-1',
    slackUserId: 'U1',
    kind: PREVIEW_KIND.PM_WRITE_BACK,
    payload: { assignments: ['before'] },
    status: (overrides.status ?? PREVIEW_STATUS.PENDING) as PreviewStatus,
    previewText: '',
    responseUrl: null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000),
    createdAt: new Date(),
    appliedAt: null,
    cancelledAt: null,
    slackChannelId: null,
    slackMessageTs: null,
    ...overrides,
  }) as PreviewAction;

describe('UpdatePreviewPayloadUsecase', () => {
  let findById: jest.Mock;
  let updatePayload: jest.Mock;
  let isApplying: jest.Mock;
  let usecase: UpdatePreviewPayloadUsecase;

  beforeEach(() => {
    findById = jest.fn().mockResolvedValue(buildPreview());
    updatePayload = jest
      .fn()
      .mockImplementation(async ({ payload }) =>
        buildPreview({ payload } as Partial<PreviewAction>),
      );
    isApplying = jest.fn().mockReturnValue(false);
    usecase = new UpdatePreviewPayloadUsecase(
      { findById, updatePayload } as unknown as PreviewActionRepositoryPort,
      { isApplying } as unknown as ApplyPreviewUsecase,
    );
  });

  // 조회·검증·변환·저장을 한 호출로 묶는 게 이 usecase 의 존재 이유다.
  it('현재 payload 를 갱신 함수에 넘기고 그 결과를 저장', async () => {
    const update = jest.fn().mockReturnValue({ assignments: ['after'] });

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      update,
    });

    expect(update).toHaveBeenCalledWith({ assignments: ['before'] });
    expect(updatePayload).toHaveBeenCalledWith({
      id: 'p-1',
      payload: { assignments: ['after'] },
    });
    expect(result.payload).toEqual({ assignments: ['after'] });
  });

  it('preview 가 없으면 NOT_FOUND', async () => {
    findById.mockResolvedValue(null);

    await expect(
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: (current) => current,
      }),
    ).rejects.toThrow();
    expect(updatePayload).not.toHaveBeenCalled();
  });

  // 남의 승인 카드를 고칠 수 있으면 승인 게이트 자체가 무의미해진다.
  it('소유자가 다르면 거절', async () => {
    await expect(
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U2',
        update: (current) => current,
      }),
    ).rejects.toThrow();
    expect(updatePayload).not.toHaveBeenCalled();
  });

  it.each([
    PREVIEW_STATUS.APPLIED,
    PREVIEW_STATUS.CANCELLED,
    PREVIEW_STATUS.EXPIRED,
  ])('이미 %s 상태면 거절', async (status) => {
    findById.mockResolvedValue(buildPreview({ status }));

    await expect(
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: (current) => current,
      }),
    ).rejects.toThrow();
    expect(updatePayload).not.toHaveBeenCalled();
  });

  it('만료된 카드는 거절 (뒤늦은 수정 차단)', async () => {
    findById.mockResolvedValue(
      buildPreview({ expiresAt: new Date(Date.now() - 1_000) }),
    );

    await expect(
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: (current) => current,
      }),
    ).rejects.toThrow();
    expect(updatePayload).not.toHaveBeenCalled();
  });

  // 실행이 시작된 뒤의 수정은 반영될 수 없다. 막지 않으면 화면에는 바뀐 내용이 남고
  // 실제로는 apply 가 시작 시점에 읽은 옛 내용이 실행돼 둘이 어긋난다.
  it('이미 apply 진행 중이면 수정을 거절', async () => {
    isApplying.mockReturnValue(true);

    await expect(
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: (current) => current,
      }),
    ).rejects.toThrow();
    expect(updatePayload).not.toHaveBeenCalled();
  });

  it('갱신 함수가 throw 하면 저장하지 않고 그대로 전파', async () => {
    await expect(
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: () => {
          throw new Error('payload 형식 오류');
        },
      }),
    ).rejects.toThrow('payload 형식 오류');
    expect(updatePayload).not.toHaveBeenCalled();
  });

  // 경력 카드의 두 입력칸에 연달아 Enter, 분배 카드의 드롭다운 둘을 빠르게 바꾸는 경우.
  // 직렬화가 없으면 둘 다 같은 payload 를 읽고 각자 한 항목만 고쳐 저장해, 나중 write 가
  // 앞선 변경을 조용히 덮는다 — 사람이 적어 넣은 문장이 그렇게 사라진다.
  it('같은 카드에 대한 동시 갱신을 직렬화한다 (lost update 차단)', async () => {
    let stored: Record<string, unknown> = { contexts: [null, null] };
    findById.mockImplementation(async () =>
      buildPreview({ payload: stored } as Partial<PreviewAction>),
    );
    updatePayload.mockImplementation(async ({ payload }) => {
      // 저장은 즉시 끝나지 않는다 — 겹칠 틈을 실제로 만든다.
      await new Promise((resolve) => setImmediate(resolve));
      stored = payload as Record<string, unknown>;
      return buildPreview({ payload } as Partial<PreviewAction>);
    });

    const writeAt = (index: number, value: string) => (current: unknown) => {
      const contexts = [...(current as { contexts: unknown[] }).contexts];
      contexts[index] = value;
      return { contexts };
    };

    await Promise.all([
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: writeAt(0, '회사 맥락'),
      }),
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: writeAt(1, '개인 맥락'),
      }),
    ]);

    expect(stored).toEqual({ contexts: ['회사 맥락', '개인 맥락'] });
  });

  it('앞 갱신이 실패해도 뒤 갱신은 진행된다 (사슬이 막히지 않는다)', async () => {
    updatePayload
      .mockRejectedValueOnce(new Error('일시 실패'))
      .mockImplementationOnce(async ({ payload }) =>
        buildPreview({ payload } as Partial<PreviewAction>),
      );

    const [failed, succeeded] = await Promise.allSettled([
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: () => ({ assignments: ['first'] }),
      }),
      usecase.execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        update: () => ({ assignments: ['second'] }),
      }),
    ]);

    expect(failed.status).toBe('rejected');
    expect(succeeded.status).toBe('fulfilled');
  });

  it('다른 카드끼리는 서로 기다리지 않는다', async () => {
    findById.mockImplementation(async () => buildPreview());
    const order: string[] = [];
    updatePayload.mockImplementation(async ({ id, payload }) => {
      if (id === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      order.push(id as string);
      return buildPreview({ payload } as Partial<PreviewAction>);
    });

    await Promise.all([
      usecase.execute({
        previewId: 'slow',
        slackUserId: 'U1',
        update: () => ({}),
      }),
      usecase.execute({
        previewId: 'fast',
        slackUserId: 'U1',
        update: () => ({}),
      }),
    ]);

    expect(order).toEqual(['fast', 'slow']);
  });
});
