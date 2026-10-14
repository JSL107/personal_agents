import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import { ArtJobPostingRepositoryPort } from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import {
  ART_JOB_EXCLUDE_ACTION,
  ART_JOB_RESTORE_ACTION,
  buildArtJobItemButton,
} from '../../art-job-feed/infrastructure/art-job-feed.formatter';
import {
  ArtJobExclusionActionHandler,
  redrawButtons,
} from './art-job-exclusion-action.handler';

type ActionHandler = (args: {
  ack: jest.Mock;
  body: unknown;
  respond: jest.Mock;
  client: { chat: { update: jest.Mock } };
}) => Promise<void>;

const HEADER = {
  type: 'section',
  text: { type: 'mrkdwn', text: '🎨 머리' },
};
const item = (sourceId: string, excluded = false) => ({
  type: 'section',
  block_id: `art-job:${sourceId}`,
  text: { type: 'mrkdwn', text: `${sourceId}번 공고` },
  accessory: buildArtJobItemButton(sourceId, excluded),
});

const buildHarness = ({
  recipient = 'U_RECIPIENT',
  found = true,
  excludedIds = ['7'],
}: { recipient?: string; found?: boolean; excludedIds?: string[] } = {}) => {
  const handlers = new Map<string, ActionHandler>();
  const app = {
    action: jest.fn((actionId: string, handler: ActionHandler) => {
      handlers.set(actionId, handler);
    }),
  } as unknown as App;
  const repository = {
    setExcluded: jest.fn().mockResolvedValue(found),
    findExcludedSourceIds: jest.fn().mockResolvedValue(new Set(excludedIds)),
  };
  const configService = {
    get: (key: string) =>
      key === 'ART_JOB_FEED_MENTION_USER_ID' ? recipient : undefined,
  } as unknown as ConfigService;
  new ArtJobExclusionActionHandler(
    configService,
    repository as unknown as ArtJobPostingRepositoryPort,
  ).register(app);
  const run = async (actionId: string, value: string, userId: string) => {
    const respond = jest.fn();
    const update = jest.fn().mockResolvedValue({});
    await handlers.get(actionId)?.({
      ack: jest.fn(),
      body: {
        user: { id: userId },
        actions: [{ value }],
        container: { channel_id: 'C_ART', message_ts: '1.1' },
        message: { text: '🎨 머리', blocks: [HEADER, item('7'), item('8')] },
      },
      respond,
      client: { chat: { update } },
    });
    return { respond, update };
  };
  return { repository, run };
};

describe('ArtJobExclusionActionHandler', () => {
  it('받는 사람이 「관심 없음」을 누르면 제외로 저장하고 버튼을 장부 상태대로 다시 그린다', async () => {
    const { repository, run } = buildHarness();

    const { respond, update } = await run(
      ART_JOB_EXCLUDE_ACTION,
      '7',
      'U_RECIPIENT',
    );

    expect(repository.setExcluded).toHaveBeenCalledWith('7', true);
    expect(repository.findExcludedSourceIds).toHaveBeenCalledWith(['7', '8']);
    expect(update).toHaveBeenCalledWith({
      channel: 'C_ART',
      ts: '1.1',
      text: '🎨 머리',
      blocks: [HEADER, item('7', true), item('8')],
    });
    expect(respond).not.toHaveBeenCalled();
  });

  it('「되돌리기」는 제외를 해제한다', async () => {
    const { repository, run } = buildHarness({ excludedIds: [] });

    const { update } = await run(ART_JOB_RESTORE_ACTION, '7', 'U_RECIPIENT');

    expect(repository.setExcluded).toHaveBeenCalledWith('7', false);
    expect(update.mock.calls[0][0].blocks).toEqual([
      HEADER,
      item('7'),
      item('8'),
    ]);
  });

  it('받는 사람이 아니면 저장하지 않고 본인에게만 알린다', async () => {
    const { repository, run } = buildHarness();

    const { respond, update } = await run(
      ART_JOB_EXCLUDE_ACTION,
      '7',
      'U_OTHER',
    );

    expect(repository.setExcluded).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(respond.mock.calls[0][0]).toMatchObject({
      response_type: 'ephemeral',
    });
  });

  it('장부에 없는 공고면 다시 그리지 않고 실패를 알린다', async () => {
    const { run } = buildHarness({ found: false });

    const { respond, update } = await run(
      ART_JOB_EXCLUDE_ACTION,
      '7',
      'U_RECIPIENT',
    );

    expect(update).not.toHaveBeenCalled();
    expect(respond.mock.calls[0][0].text).toContain('반영하지 못했어요');
  });
});

describe('redrawButtons', () => {
  it('공고 블록의 버튼만 바꾸고 버튼 없는 블록은 그대로 둔다', () => {
    const plain = { type: 'section', block_id: 'art-job:9', text: {} };

    expect(
      redrawButtons([HEADER, item('7'), plain], new Set(['7', '9'])),
    ).toEqual([HEADER, item('7', true), plain]);
  });
});
