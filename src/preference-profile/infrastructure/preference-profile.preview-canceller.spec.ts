import { PREVIEW_CANCEL_REASON } from '../../preview-gate/domain/port/preview-canceller.port';
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
  slackChannelId: null,
  slackMessageTs: null,
});

describe('PreferenceProfileCanceller', () => {
  it('❌ 거부(CANCELLED) 면 markResolved(id, REJECTED) 호출', async () => {
    const proposalRepo = {
      markResolved: jest.fn().mockResolvedValue(undefined),
    };
    const canceller = new PreferenceProfileCanceller(proposalRepo as never);

    await canceller.onCancel(
      buildPreview({ proposalId: 42 }),
      PREVIEW_CANCEL_REASON.CANCELLED,
    );

    expect(proposalRepo.markResolved).toHaveBeenCalledWith(42, 'REJECTED');
  });

  // 대조군 — 무응답 만료는 거부가 아니다. REJECTED 로 쓰면 recentDecisions(APPROVED/REJECTED)가
  // 이를 학습 신호로 흡수해 "사용자가 물렸다"로 잘못 배운다
  // (preview-decision.signal-source.ts:45 가 EXPIRED 를 제외하는 것과 같은 이유).
  it('무응답 만료(EXPIRED) 면 markResolved(id, EXPIRED) 호출 — REJECTED 로 쓰지 않는다', async () => {
    const proposalRepo = {
      markResolved: jest.fn().mockResolvedValue(undefined),
    };
    const canceller = new PreferenceProfileCanceller(proposalRepo as never);

    await canceller.onCancel(
      buildPreview({ proposalId: 42 }),
      PREVIEW_CANCEL_REASON.EXPIRED,
    );

    expect(proposalRepo.markResolved).toHaveBeenCalledWith(42, 'EXPIRED');
    expect(proposalRepo.markResolved).not.toHaveBeenCalledWith(42, 'REJECTED');
  });

  it('payload.proposalId 가 숫자가 아니면 no-op', async () => {
    const proposalRepo = { markResolved: jest.fn() };
    const canceller = new PreferenceProfileCanceller(proposalRepo as never);

    await canceller.onCancel(buildPreview({}), PREVIEW_CANCEL_REASON.CANCELLED);
    await canceller.onCancel(
      buildPreview({ proposalId: 'nope' }),
      PREVIEW_CANCEL_REASON.EXPIRED,
    );

    expect(proposalRepo.markResolved).not.toHaveBeenCalled();
  });

  it('kind 는 PREFERENCE_PROFILE', () => {
    const canceller = new PreferenceProfileCanceller({
      markResolved: jest.fn(),
    } as never);
    expect(canceller.kind).toBe(PREVIEW_KIND.PREFERENCE_PROFILE);
  });
});
