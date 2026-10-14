import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';

import { ArtJobPostingRepositoryPort } from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import {
  ART_JOB_EXCLUDE_ACTION,
  ART_JOB_INTEREST_ACTION,
  ART_JOB_RESTORE_ACTION,
  ART_JOB_UNINTEREST_ACTION,
  buildArtJobItemActions,
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

// 지금 형식 — 글(section) 아래 버튼 줄(actions). 7번은 마감일이 있어 「관심 있음」이 달린 줄.
const row = (
  sourceId: string,
  state: { interestable?: boolean; interested?: boolean; excluded?: boolean },
) =>
  buildArtJobItemActions(sourceId, {
    interestable: state.interestable ?? true,
    interested: state.interested ?? false,
    excluded: state.excluded ?? false,
  });

interface HarnessOptions {
  recipient?: string;
  found?: boolean;
  excludedIds?: string[];
  interestedIds?: string[];
  deadlineDate?: { year: number; month: number; day: number } | null;
  blocks?: Record<string, unknown>[];
}

const buildHarness = ({
  recipient = 'U_RECIPIENT',
  found = true,
  excludedIds = ['7'],
  interestedIds = [],
  deadlineDate = { year: 2999, month: 1, day: 1 },
  blocks = [HEADER, item('7'), item('8')],
}: HarnessOptions = {}) => {
  const handlers = new Map<string, ActionHandler>();
  const app = {
    action: jest.fn((actionId: string, handler: ActionHandler) => {
      handlers.set(actionId, handler);
    }),
  } as unknown as App;
  const repository = {
    setExcluded: jest.fn().mockResolvedValue(found),
    findExcludedSourceIds: jest.fn().mockResolvedValue(new Set(excludedIds)),
    setInterested: jest.fn().mockResolvedValue(found ? { deadlineDate } : null),
    findInterestedSourceIds: jest
      .fn()
      .mockResolvedValue(new Set(interestedIds)),
  };
  const configService = {
    get: (key: string) =>
      ({
        ART_JOB_FEED_MENTION_USER_ID: recipient,
        AUTOPILOT_OWNER_SLACK_USER_ID: 'U_OWNER',
      })[key],
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
        message: { text: '🎨 머리', blocks },
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

  it('운영자도 누를 수 있다', async () => {
    const { repository, run } = buildHarness();

    const { respond } = await run(ART_JOB_EXCLUDE_ACTION, '7', 'U_OWNER');

    expect(repository.setExcluded).toHaveBeenCalledWith('7', true);
    expect(respond).not.toHaveBeenCalled();
  });

  it('운영자가 「관심 있음」을 누르면 누른 사람으로 운영자를 남긴다', async () => {
    const { repository, run } = buildHarness({
      blocks: [HEADER, row('7', {})],
    });

    await run(ART_JOB_INTEREST_ACTION, '7', 'U_OWNER');

    expect(repository.setInterested).toHaveBeenCalledWith('7', true, 'U_OWNER');
  });

  it('받는 사람이 설정되지 않았으면 운영자도 누를 수 없다', async () => {
    const { repository, run } = buildHarness({ recipient: '' });

    const { respond } = await run(ART_JOB_EXCLUDE_ACTION, '7', 'U_OWNER');

    expect(repository.setExcluded).not.toHaveBeenCalled();
    expect(respond.mock.calls[0][0].text).toContain('운영자만');
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

describe('ArtJobExclusionActionHandler — 관심 있음', () => {
  const rowBlocks = [HEADER, row('7', {}), row('8', { interestable: false })];

  it('「관심 있음」을 저장하고 버튼 줄을 장부 상태대로 다시 그린다', async () => {
    const { repository, run } = buildHarness({
      excludedIds: [],
      interestedIds: ['7'],
      blocks: rowBlocks,
    });

    const { respond, update } = await run(
      ART_JOB_INTEREST_ACTION,
      '7',
      'U_RECIPIENT',
    );

    expect(repository.setInterested).toHaveBeenCalledWith(
      '7',
      true,
      'U_RECIPIENT',
    );
    expect(repository.findInterestedSourceIds).toHaveBeenCalledWith(['7', '8']);
    // 마감일 없는 8번 줄은 다시 그려도 「관심 있음」이 생기지 않는다.
    expect(update.mock.calls[0][0].blocks).toEqual([
      HEADER,
      row('7', { interested: true }),
      row('8', { interestable: false }),
    ]);
    expect(respond).not.toHaveBeenCalled();
  });

  it('「되돌리기」는 관심을 해제한다', async () => {
    const { repository, run } = buildHarness({
      excludedIds: [],
      blocks: [HEADER, row('7', { interested: true })],
    });

    const { update } = await run(ART_JOB_UNINTEREST_ACTION, '7', 'U_RECIPIENT');

    expect(repository.setInterested).toHaveBeenCalledWith(
      '7',
      false,
      'U_RECIPIENT',
    );
    expect(update.mock.calls[0][0].blocks).toEqual([HEADER, row('7', {})]);
  });

  it('전날 알림 시각이 이미 지났으면 저장은 하되 DM 이 없다고 알린다', async () => {
    const { repository, run } = buildHarness({
      excludedIds: [],
      deadlineDate: { year: 2000, month: 1, day: 1 },
      blocks: rowBlocks,
    });

    const { respond } = await run(ART_JOB_INTEREST_ACTION, '7', 'U_RECIPIENT');

    expect(repository.setInterested).toHaveBeenCalledWith(
      '7',
      true,
      'U_RECIPIENT',
    );
    expect(respond.mock.calls[0][0]).toMatchObject({
      response_type: 'ephemeral',
      text: expect.stringContaining('알림 시각이 이미 지나'),
    });
  });

  it('장부에 마감일이 없으면 알림이 없다고 알린다', async () => {
    const { run } = buildHarness({ deadlineDate: null, blocks: rowBlocks });

    const { respond } = await run(ART_JOB_INTEREST_ACTION, '7', 'U_RECIPIENT');

    expect(respond.mock.calls[0][0].text).toContain('마감일을 알 수 없어');
  });

  it('장부에 없는 공고면 실패를 알린다', async () => {
    const { run } = buildHarness({ found: false, blocks: rowBlocks });

    const { respond, update } = await run(
      ART_JOB_INTEREST_ACTION,
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
      redrawButtons([HEADER, item('7'), plain], {
        excludedIds: new Set(['7', '9']),
        interestedIds: new Set(['7']),
      }),
    ).toEqual([HEADER, item('7', true), plain]);
  });
});
