import { PreferenceProfilePreviewApplier } from './preference-profile.preview-applier';

const buildPreview = (payload: unknown) =>
  ({
    id: 'prev-1',
    slackUserId: 'U1',
    kind: 'PREFERENCE_PROFILE',
    payload,
    status: 'PENDING',
    previewText: '미리보기',
    responseUrl: null,
    expiresAt: new Date(),
    createdAt: new Date(),
    appliedAt: null,
    cancelledAt: null,
  }) as never;

describe('PreferenceProfilePreviewApplier', () => {
  it('APPLIED → 반영 메시지 반환, applyService.apply 가 proposalId 로 호출됨', async () => {
    const applyService = { apply: jest.fn().mockResolvedValue('APPLIED') } as never;
    const applier = new PreferenceProfilePreviewApplier(applyService);
    const result = await applier.apply(buildPreview({ proposalId: 42 }));
    expect(result.message).toContain('반영');
    expect(result.artifacts).toEqual([]);
    expect((applyService as { apply: jest.Mock }).apply).toHaveBeenCalledWith(42);
  });

  it('STALE → STALE 포함 메시지 반환', async () => {
    const applyService = { apply: jest.fn().mockResolvedValue('STALE') } as never;
    const applier = new PreferenceProfilePreviewApplier(applyService);
    const result = await applier.apply(buildPreview({ proposalId: 5 }));
    expect(result.message).toContain('STALE');
  });

  it('NOT_FOUND → 찾을 수 없 포함 메시지 반환', async () => {
    const applyService = { apply: jest.fn().mockResolvedValue('NOT_FOUND') } as never;
    const applier = new PreferenceProfilePreviewApplier(applyService);
    const result = await applier.apply(buildPreview({ proposalId: 99 }));
    expect(result.message).toContain('찾을 수 없');
  });

  it('payload 에 numeric proposalId 없으면 throw', async () => {
    const applyService = { apply: jest.fn() } as never;
    const applier = new PreferenceProfilePreviewApplier(applyService);
    await expect(applier.apply(buildPreview({}))).rejects.toThrow(
      'proposalId',
    );
    await expect(applier.apply(buildPreview({ proposalId: 'str' }))).rejects.toThrow(
      'proposalId',
    );
    await expect(applier.apply(buildPreview(null))).rejects.toThrow(
      'proposalId',
    );
  });
});
