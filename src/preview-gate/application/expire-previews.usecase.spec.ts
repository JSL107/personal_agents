import { PreviewActionRepositoryPort } from '../domain/port/preview-action.repository.port';
import { PreviewCardPort } from '../domain/port/preview-card.port';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { ExpirePreviewsUsecase } from './expire-previews.usecase';

const buildPreview = (id: string): PreviewAction => ({
  id,
  slackUserId: 'U1',
  kind: 'EVENING_BLOG_PUBLISH' as PreviewAction['kind'],
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
  countOutcomesByKind: jest.fn(),
  transition: jest
    .fn()
    .mockImplementation(({ id, status }) =>
      Promise.resolve({ ...buildPreview(id), status }),
    ),
  attachSlackMessage: jest.fn(),
  findExpiredPending: jest.fn().mockResolvedValue(expired),
});

const buildCard = (): jest.Mocked<PreviewCardPort> => ({
  update: jest.fn().mockResolvedValue(undefined),
});

const now = new Date('2026-07-01T12:00:00Z');

describe('ExpirePreviewsUsecase', () => {
  it('만료 0건이면 0 반환, 전이/갱신 없음', async () => {
    const repo = buildRepo([]);
    const card = buildCard();
    const usecase = new ExpirePreviewsUsecase(repo, card);

    const count = await usecase.execute({ now });

    expect(count).toBe(0);
    expect(repo.transition).not.toHaveBeenCalled();
    expect(card.update).not.toHaveBeenCalled();
  });

  it('만료 N건이면 각각 EXPIRED 전이 + 카드 EXPIRED 갱신 후 건수 반환', async () => {
    const repo = buildRepo([buildPreview('p-1'), buildPreview('p-2')]);
    const card = buildCard();
    const usecase = new ExpirePreviewsUsecase(repo, card);

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

  it('한 건 전이가 throw 해도 나머지는 계속 처리한다', async () => {
    const repo = buildRepo([buildPreview('p-1'), buildPreview('p-2')]);
    repo.transition.mockRejectedValueOnce(new Error('db hiccup'));
    const card = buildCard();
    const usecase = new ExpirePreviewsUsecase(repo, card);

    const count = await usecase.execute({ now });

    // p-1 실패, p-2 성공 → 1건 처리
    expect(count).toBe(1);
  });
});
