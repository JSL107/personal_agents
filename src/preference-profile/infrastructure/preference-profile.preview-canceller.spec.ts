import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { PreferenceProfileCanceller } from './preference-profile.preview-canceller';

const buildPreview = (payload: unknown): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.PREFERENCE_PROFILE,
  payload,
  status: 'CANCELLED',
  previewText: 'x',
  responseUrl: null,
  expiresAt: new Date('2026-07-01T00:00:00.000Z'),
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  appliedAt: null,
  cancelledAt: new Date('2026-07-01T00:00:00.000Z'),
});

describe('PreferenceProfileCanceller', () => {
  it('payload.proposalId 가 있으면 markResolved(id, REJECTED) 호출', async () => {
    const proposalRepo = {
      markResolved: jest.fn().mockResolvedValue(undefined),
    };
    const canceller = new PreferenceProfileCanceller(proposalRepo as never);

    await canceller.onCancel(buildPreview({ proposalId: 42 }));

    expect(proposalRepo.markResolved).toHaveBeenCalledWith(42, 'REJECTED');
  });

  it('payload.proposalId 가 숫자가 아니면 no-op', async () => {
    const proposalRepo = { markResolved: jest.fn() };
    const canceller = new PreferenceProfileCanceller(proposalRepo as never);

    await canceller.onCancel(buildPreview({}));
    await canceller.onCancel(buildPreview({ proposalId: 'nope' }));

    expect(proposalRepo.markResolved).not.toHaveBeenCalled();
  });

  it('kind 는 PREFERENCE_PROFILE', () => {
    const canceller = new PreferenceProfileCanceller({
      markResolved: jest.fn(),
    } as never);
    expect(canceller.kind).toBe(PREVIEW_KIND.PREFERENCE_PROFILE);
  });
});
