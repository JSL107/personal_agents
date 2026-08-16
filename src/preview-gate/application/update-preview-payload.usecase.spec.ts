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
    kind: PREVIEW_KIND.CTO_BE_CHAIN,
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
});
