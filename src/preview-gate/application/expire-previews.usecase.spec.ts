import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_CANCEL_REASON,
  PreviewCanceller,
} from '../domain/port/preview-canceller.port';
import { PreviewCardPort } from '../domain/port/preview-card.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../domain/preview-action.type';
import { ExpirePreviewsUsecase } from './expire-previews.usecase';

const buildPreview = (
  id: string,
  kind: PreviewAction['kind'] = 'EVENING_BLOG_PUBLISH',
): PreviewAction => ({
  id,
  slackUserId: 'U1',
  kind,
  payload: {},
  status: PREVIEW_STATUS.PENDING,
  previewText: 't',
  responseUrl: null,
  expiresAt: new Date('2026-07-01T00:00:00Z'),
  createdAt: new Date('2026-06-30T00:00:00Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: 'C1',
  slackMessageTs: '111.222',
});

const buildRepo = (
  expired: PreviewAction[],
): jest.Mocked<PreviewActionRepositoryPort> => ({
  create: jest.fn(),
  findById: jest.fn(),
  findLatestPendingForUser: jest.fn(),
  updatePayload: jest.fn(),
  countOutcomesByKind: jest.fn(),
  countByPayloadValue: jest.fn().mockResolvedValue(0),
  transition: jest
    .fn()
    .mockImplementation(({ id, status }) =>
      Promise.resolve({ ...buildPreview(id), status }),
    ),
  attachSlackMessage: jest.fn(),
  findExpiredPending: jest.fn().mockResolvedValue(expired),
  findAllOpen: jest.fn().mockResolvedValue([]),
  findAllDayOutcomes: jest.fn().mockResolvedValue([]),
});

// kind 를 보존해 전이하는 repo — canceller 매칭은 전이 후 row 의 kind 로 이뤄지므로
// 기본 buildRepo(kind 고정) 로는 kind 별 분기를 검증할 수 없다.
const buildKindPreservingRepo = (
  expired: PreviewAction[],
): jest.Mocked<PreviewActionRepositoryPort> => {
  const repository = buildRepo(expired);
  repository.transition.mockImplementation(({ id, status }) => {
    const found = expired.find((preview) => preview.id === id);
    return Promise.resolve({ ...buildPreview(id, found?.kind), status });
  });
  return repository;
};

const buildCard = (): jest.Mocked<PreviewCardPort> => ({
  update: jest.fn().mockResolvedValue(undefined),
});

const now = new Date('2026-07-01T12:00:00Z');

describe('ExpirePreviewsUsecase', () => {
  it('만료 0건이면 0 반환, 전이/갱신 없음', async () => {
    const repo = buildRepo([]);
    const card = buildCard();
    const usecase = new ExpirePreviewsUsecase(repo, [], card);

    const count = await usecase.execute({ now });

    expect(count).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
    expect(card.update).not.toHaveBeenCalled();
  });

  it('만료 N건이면 각각 EXPIRED 전이 + 카드 EXPIRED 갱신 후 건수 반환', async () => {
    const repo = buildRepo([buildPreview('p-1'), buildPreview('p-2')]);
    const card = buildCard();
    const usecase = new ExpirePreviewsUsecase(repo, [], card);

    const count = await usecase.execute({ now });

    expect(count).toBe(2);
    expect(repo.transition).toHaveBeenCalledWith({
      id: 'p-1',
      status: PREVIEW_STATUS.EXPIRED,
    });
    expect(card.update).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'EXPIRED' }),
    );
    expect(card.update).toHaveBeenCalledTimes(2);
  });

  it('만료 처리한 각 건에 approval.resolved 이벤트를 발행한다', async () => {
    const repo = buildRepo([buildPreview('p-1'), buildPreview('p-2')]);
    const bus = {
      publish: jest.fn(),
      stream: jest.fn(),
    } as unknown as ConsoleEventBus;
    const usecase = new ExpirePreviewsUsecase(repo, [], buildCard(), bus);

    await usecase.execute({ now });

    const resolved = (bus.publish as jest.Mock).mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === 'approval.resolved');
    expect(resolved).toHaveLength(2);
    expect(resolved[0].approval).toEqual({
      id: 'p-1',
      agentType: 'EVENING_RETRO',
      title: 't',
      createdAt: '2026-06-30T00:00:00.000Z',
      expiresAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('한 건 전이가 throw 해도 나머지는 계속 처리한다', async () => {
    const repo = buildRepo([buildPreview('p-1'), buildPreview('p-2')]);
    repo.transition.mockRejectedValueOnce(new Error('db hiccup'));
    const card = buildCard();
    const usecase = new ExpirePreviewsUsecase(repo, [], card);

    const count = await usecase.execute({ now });

    // p-1 실패, p-2 성공 → 1건 처리
    expect(count).toBe(1);
  });

  // 무응답 만료도 kind 별 후처리를 받아야 한다. 이게 없으면 연동 레코드(PreferenceProposal 등)가
  // PENDING 으로 영구 잔류하고, 선호 학습의 쿼터 가드가 그 PENDING 을 보고 7일간 skip 한다
  // (preference-learning.autopilot-task.ts:68-77).
  it('만료 처리 시 kind 일치 canceller 를 EXPIRED 사유로 호출한다', async () => {
    const repo = buildKindPreservingRepo([
      buildPreview('p-1', PREVIEW_KIND.PREFERENCE_PROFILE),
    ]);
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn().mockResolvedValue(undefined),
    };
    const usecase = new ExpirePreviewsUsecase(repo, [canceller], buildCard());

    await usecase.execute({ now });

    expect(canceller.onCancel).toHaveBeenCalledTimes(1);
    expect(canceller.onCancel).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p-1',
        status: PREVIEW_STATUS.EXPIRED,
      }),
      PREVIEW_CANCEL_REASON.EXPIRED,
    );
  });

  // 대조군 — kind 가 다르면 부르지 않는다(무차별 호출이 아니라 매칭 후 호출임을 고정).
  it('kind 불일치 canceller 는 호출 안 함', async () => {
    const repo = buildKindPreservingRepo([
      buildPreview('p-1', PREVIEW_KIND.PM_WRITE_BACK),
    ]);
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn(),
    };
    const usecase = new ExpirePreviewsUsecase(repo, [canceller], buildCard());

    await usecase.execute({ now });

    expect(canceller.onCancel).not.toHaveBeenCalled();
  });

  // 카드 갱신은 Slack API 라 흔히 실패한다. 그때 canceller 를 건너뛰면 row 가 이미 EXPIRED 라
  // 다음 스윕(findExpiredPending = PENDING 만)에 다시 잡히지 않아 후처리를 영영 못 받는다.
  it('카드 갱신이 실패해도 canceller 는 호출되고 만료로 집계된다', async () => {
    const repo = buildKindPreservingRepo([
      buildPreview('p-1', PREVIEW_KIND.PREFERENCE_PROFILE),
    ]);
    const card = buildCard();
    card.update.mockRejectedValue(new Error('slack down'));
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn().mockResolvedValue(undefined),
    };
    const usecase = new ExpirePreviewsUsecase(repo, [canceller], card);

    const count = await usecase.execute({ now });

    expect(canceller.onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ status: PREVIEW_STATUS.EXPIRED }),
      PREVIEW_CANCEL_REASON.EXPIRED,
    );
    expect(count).toBe(1);
  });

  it('onCancel 이 throw 해도 만료 처리는 성공으로 집계된다(best-effort)', async () => {
    const repo = buildKindPreservingRepo([
      buildPreview('p-1', PREVIEW_KIND.PREFERENCE_PROFILE),
    ]);
    const canceller: jest.Mocked<PreviewCanceller> = {
      kind: PREVIEW_KIND.PREFERENCE_PROFILE,
      onCancel: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const usecase = new ExpirePreviewsUsecase(repo, [canceller], buildCard());

    const count = await usecase.execute({ now });

    expect(count).toBe(1);
  });
});
