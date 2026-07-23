import { PreviewAction } from '../domain/preview-action.type';
import { SlackPreviewCardUpdater } from './slack-preview-card.updater';

const buildPreview = (
  overrides: Partial<PreviewAction> = {},
): PreviewAction => ({
  id: 'p-1',
  slackUserId: 'U1',
  kind: 'EVENING_BLOG_PUBLISH' as PreviewAction['kind'],
  payload: {},
  status: 'PENDING' as PreviewAction['status'],
  previewText: '원본 미리보기',
  responseUrl: null,
  expiresAt: new Date(),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: 'C1',
  slackMessageTs: '111.222',
  ...overrides,
});

describe('SlackPreviewCardUpdater', () => {
  it('좌표가 있으면 chat.update 를 호출한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const client = { chat: { update } } as never;
    const updater = new SlackPreviewCardUpdater(client);

    await updater.update({
      preview: buildPreview(),
      state: 'APPLIED',
      resultText: '발행 완료',
    });

    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.channel).toBe('C1');
    expect(arg.ts).toBe('111.222');
  });

  it('slackMessageTs 가 없으면 no-op (B/C 경로)', async () => {
    const update = jest.fn();
    const client = { chat: { update } } as never;
    const updater = new SlackPreviewCardUpdater(client);

    await updater.update({
      preview: buildPreview({ slackMessageTs: null }),
      state: 'EXPIRED',
    });

    expect(update).not.toHaveBeenCalled();
  });

  it('client 가 null(토큰 미설정)이면 no-op', async () => {
    const updater = new SlackPreviewCardUpdater(null);

    await expect(
      updater.update({ preview: buildPreview(), state: 'APPLIED' }),
    ).resolves.toBeUndefined();
  });

  it('chat.update 가 throw 해도 swallow (apply 를 막지 않음)', async () => {
    const update = jest.fn().mockRejectedValue(new Error('slack down'));
    const client = { chat: { update } } as never;
    const updater = new SlackPreviewCardUpdater(client);

    await expect(
      updater.update({ preview: buildPreview(), state: 'APPLIED' }),
    ).resolves.toBeUndefined();
  });
});
