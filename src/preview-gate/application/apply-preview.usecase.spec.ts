import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewApplier } from '../domain/port/preview-applier.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';
import { ApplyPreviewUsecase } from './apply-preview.usecase';

const fixedNow = new Date('2026-04-27T12:00:00.000Z');

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PM_WRITE_BACK,
  payload: { foo: 'bar' },
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
  transition: jest
    .fn()
    .mockImplementation(({ id, status }) =>
      Promise.resolve(buildPreview({ id, status })),
    ),
});

const buildApplier = (
  kind: PreviewApplier['kind'],
  result = 'applied',
): jest.Mocked<PreviewApplier> => ({
  kind,
  apply: jest.fn().mockResolvedValue(result),
});

describe('ApplyPreviewUsecase', () => {
  it('PENDING + 소유자 + ttl 통과 시 strategy.apply 위임 후 APPLIED 전이', async () => {
    const preview = buildPreview();
    const repo = buildRepo(preview);
    const applier = buildApplier(
      PREVIEW_KIND.PM_WRITE_BACK,
      'PR #707 코멘트 추가',
    );
    const usecase = new ApplyPreviewUsecase(repo, [applier]);

    const result = await usecase.execute({
      previewId: 'p-1',
      slackUserId: 'U1',
      now: fixedNow,
    });

    expect(applier.apply).toHaveBeenCalledWith(preview);
    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.APPLIED,
    });
    expect(result.resultText).toBe('PR #707 코멘트 추가');
  });

  it('미존재 previewId 면 NOT_FOUND', async () => {
    const repo = buildRepo(null);
    const usecase = new ApplyPreviewUsecase(repo, []);

    await expect(
      usecase.execute({
        previewId: 'missing',
        slackUserId: 'U1',
        now: fixedNow,
      }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NOT_FOUND,
    });
  });

  it('owner 매칭 실패 시 WRONG_OWNER 예외 (다른 사용자 preview 보호)', async () => {
    const repo = buildRepo(buildPreview({ slackUserId: 'U-other' }));
    const usecase = new ApplyPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.WRONG_OWNER,
    });
  });

  it('이미 APPLIED 인 preview 는 ALREADY_RESOLVED 예외', async () => {
    const repo = buildRepo(buildPreview({ status: PREVIEW_STATUS.APPLIED }));
    const usecase = new ApplyPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.ALREADY_RESOLVED,
    });
  });

  it('만료된 preview 는 EXPIRED 전이 후 EXPIRED 예외', async () => {
    const repo = buildRepo(
      buildPreview({ expiresAt: new Date('2026-04-27T11:30:00.000Z') }),
    );
    const usecase = new ApplyPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.EXPIRED,
    });
    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.EXPIRED,
    });
  });

  it('kind 에 매칭되는 PreviewApplier 가 없으면 NO_APPLIER_FOR_KIND 예외', async () => {
    // PM_WRITE_BACK preview 가 있는데 PREVIEW_APPLIERS multi-provider 가 비어있는 DI 미스 상황을 시뮬레이션.
    const repo = buildRepo(buildPreview());
    const usecase = new ApplyPreviewUsecase(repo, []);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toMatchObject({
      previewActionErrorCode: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
    });
  });

  it('strategy.apply 가 throw 하면 APPLIED 전이 안 함 (재시도 가능)', async () => {
    const repo = buildRepo(buildPreview());
    const applier = buildApplier(PREVIEW_KIND.PM_WRITE_BACK);
    applier.apply.mockRejectedValue(new Error('GitHub API down'));
    const usecase = new ApplyPreviewUsecase(repo, [applier]);

    await expect(
      usecase.execute({ previewId: 'p-1', slackUserId: 'U1', now: fixedNow }),
    ).rejects.toThrow('GitHub API down');
    // EXPIRED 전이는 호출되지 않음 (만료 아니므로). APPLIED 전이도 호출되지 않음.
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('PreviewActionException 은 도메인 정책 그대로 throw (Slack handler 가 user-friendly 메시지로 변환)', async () => {
    const repo = buildRepo(buildPreview());
    const usecase = new ApplyPreviewUsecase(repo, []);

    const error = await usecase
      .execute({
        previewId: 'p-1',
        slackUserId: 'U1',
        now: fixedNow,
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(PreviewActionException);
  });
});
