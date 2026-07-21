import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewCanceller } from '../domain/port/preview-canceller.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';
import { CancelPreviewUsecase } from './cancel-preview.usecase';

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload: {},
  status: PREVIEW_STATUS.PENDING,
  previewText: 'preview',
  responseUrl: null,
  expiresAt: new Date('2026-04-27T13:00:00.000Z'),
  createdAt: new Date('2026-04-27T11:00:00.000Z'),
  appliedAt: null,
  cancelledAt: null,
  ...overrides,
});

const buildRepo = (
  preview: PreviewAction | null,
): jest.Mocked<PreviewActionRepositoryPort> => ({
  create: jest.fn(),
  findById: jest.fn().mockResolvedValue(preview),
  findLatestPendingForUser: jest.fn().mockResolvedValue(null),
  countOutcomesByKind: jest.fn().mockResolvedValue([]),
  transition: jest.fn().mockImplementation(({ id, status }) =>
    // 실제 Prisma repo 는 업데이트된 전체 row 를 반환(kind/payload 보존). mock 도 동일하게.
    Promise.resolve(buildPreview({ ...(preview ?? {}), id, status })),
  ),
});

describe('CancelPreviewUsecase', () => {
  it('PENDING + 소유자 일치하면 CANCELLED 전이', async () => {
    const repo = buildRepo(buildPreview());
    const usecase = new CancelPreviewUsecase(repo, []);

    await usecase.execute({ previewId: 'p-1', slackUserId: 'U1' });

    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.CANCELLED,
    });
  });

  it('미존재 previewId 는 NOT_FOUND', async () => {
    const repo = buildRepo(null);
    const usecase = new CancelPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'missing', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NOT_FOUND,
    });
  });

  it('owner 매칭 실패 시 WRONG_OWNER', async () => {
    const repo = buildRepo(buildPreview({ slackUserId: 'U-other' }));
    const usecase = new CancelPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.WRONG_OWNER,
    });
  });

  it('이미 APPLIED 인 preview 는 ALREADY_RESOLVED', async () => {
    const repo = buildRepo(buildPreview({ status: PREVIEW_STATUS.APPLIED }));
    const usecase = new CancelPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.ALREADY_RESOLVED,
    });
  });

  it('kind 일치 canceller 의 onCancel 을 CANCELLED 전이 후 호출', async () => {
    const repo = buildRepo(
      buildPreview({ kind: PREVIEW_KIND.PREFERENCE_PROFILE }),
    );
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn().mockResolvedValue(undefined),
    };
    const usecase = new CancelPreviewUsecase(repo, [canceller]);

    await usecase.execute({ previewId: 'p-1', slackUserId: 'U1' });

    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.CANCELLED,
    });
    expect(canceller.onCancel).toHaveBeenCalledTimes(1);
    expect(canceller.onCancel.mock.calls[0][0].kind).toBe(
      PREVIEW_KIND.PREFERENCE_PROFILE,
    );
  });

  it('kind 불일치 canceller 는 호출 안 함', async () => {
    const repo = buildRepo(buildPreview({ kind: PREVIEW_KIND.PM_WRITE_BACK }));
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn(),
    };
    const usecase = new CancelPreviewUsecase(repo, [canceller]);

    await usecase.execute({ previewId: 'p-1', slackUserId: 'U1' });

    expect(canceller.onCancel).not.toHaveBeenCalled();
  });

  it('onCancel 이 throw 해도 cancel 자체는 성공(best-effort)', async () => {
    const repo = buildRepo(
      buildPreview({ kind: PREVIEW_KIND.PREFERENCE_PROFILE }),
    );
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const usecase = new CancelPreviewUsecase(repo, [canceller]);

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
    });

    expect(result.status).toBe(PREVIEW_STATUS.CANCELLED);
  });
});
