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
  expiresAt: new Date(),
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: 'C1',
  slackMessageTs: '111.222',
  slackThreadTs: '111.222',
  lastFailedAt: null,
  lastFailureReason: null,
  applyProgress: null,
  ...overrides,
});

describe('SlackPreviewCardUpdater', () => {
  it.each([
    'APPLYING',
    'APPLIED',
    'CANCELLED',
    'EXPIRED',
    'APPLY_FAILED',
  ] as const)('%s 갱신에는 짧은 카드 문구를 유지한다', async (state) => {
    const update = jest.fn().mockResolvedValue({});
    const updater = new SlackPreviewCardUpdater({ chat: { update } } as never);

    await updater.update({
      preview: buildPreview({ previewText: '긴 전문', slackText: '짧은 카드' }),
      state,
    });

    const args = update.mock.calls[0][0];
    expect(args.text).toBe('짧은 카드');
    expect(JSON.stringify(args.blocks)).toContain('짧은 카드');
    expect(JSON.stringify(args.blocks)).not.toContain('긴 전문');
  });

  it('명시한 결과 문구는 짧은 카드보다 우선한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const updater = new SlackPreviewCardUpdater({ chat: { update } } as never);

    await updater.update({
      preview: buildPreview({ previewText: '긴 전문', slackText: '짧은 카드' }),
      state: 'APPLIED',
      resultText: '발행 완료',
    });

    expect(update.mock.calls[0][0].text).toBe('발행 완료');
  });

  it('옛 카드에는 원래 전문을 사용한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const updater = new SlackPreviewCardUpdater({ chat: { update } } as never);

    await updater.update({
      preview: buildPreview({ previewText: '옛 카드 전문', slackText: null }),
      state: 'EXPIRED',
    });

    expect(update.mock.calls[0][0].text).toBe('옛 카드 전문');
  });

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
