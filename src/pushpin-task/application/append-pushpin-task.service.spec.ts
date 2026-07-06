import { ConfigService } from '@nestjs/config';

import { NotionClientPort } from '../../notion/domain/port/notion-client.port';
import {
  AppendPushpinTaskService,
  buildDailyChildPageTitle,
  buildPushpinTaskBlocks,
} from './append-pushpin-task.service';

describe('AppendPushpinTaskService', () => {
  let notionClient: jest.Mocked<NotionClientPort>;
  let configGet: jest.Mock;
  let service: AppendPushpinTaskService;

  beforeEach(() => {
    notionClient = {
      listActiveTasks: jest.fn(),
      findOrCreateDailyPage: jest.fn(),
      findOrCreateChildPage: jest.fn(),
      appendBlocks: jest.fn().mockResolvedValue(undefined),
      updatePageProperties: jest.fn().mockResolvedValue(undefined),
      replaceCheckInSection: jest.fn(),
      replaceAllBlocks: jest.fn(),
    };
    configGet = jest.fn();
    service = new AppendPushpinTaskService(notionClient, {
      get: configGet,
    } as unknown as ConfigService);
  });

  const baseInput = {
    slackUserId: 'U1',
    channelId: 'C1',
    messageTs: '1700000000.000100',
    text: 'PR #34 리뷰 의뢰',
  };

  it('SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID 미설정 → appended=false + skipReason 전달', async () => {
    configGet.mockReturnValue(undefined);
    const result = await service.execute(baseInput);
    expect(result.appended).toBe(false);
    expect(result.skipReason).toContain(
      'SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID',
    );
    expect(notionClient.findOrCreateChildPage).not.toHaveBeenCalled();
    expect(notionClient.appendBlocks).not.toHaveBeenCalled();
  });

  it('빈 메시지 → appended=false + skipReason="빈 메시지"', async () => {
    configGet.mockReturnValue('parent-page-id');
    const result = await service.execute({ ...baseInput, text: '   ' });
    expect(result).toEqual({ appended: false, skipReason: '빈 메시지' });
    expect(notionClient.findOrCreateChildPage).not.toHaveBeenCalled();
  });

  it('정상 — daily 자식 페이지 찾거나 만들고 bullet append', async () => {
    configGet.mockReturnValue('parent-page-id');
    notionClient.findOrCreateChildPage.mockResolvedValue({
      pageId: 'daily-page-id',
      url: 'https://notion.so/daily',
    });

    const result = await service.execute({
      ...baseInput,
      permalink: 'https://workspace.slack.com/archives/C1/p1700000000000100',
    });

    expect(result.appended).toBe(true);
    expect(notionClient.findOrCreateChildPage).toHaveBeenCalledWith({
      parentPageId: 'parent-page-id',
      title: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \(.\)$/),
    });
    expect(notionClient.appendBlocks).toHaveBeenCalledWith({
      pageId: 'daily-page-id',
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'todo',
          text: expect.stringContaining('PR #34 리뷰 의뢰'),
        }),
        expect.objectContaining({
          type: 'bullet',
          link: 'https://workspace.slack.com/archives/C1/p1700000000000100',
        }),
      ]),
    });
  });

  it('permalink 없으면 link bullet 생략', async () => {
    configGet.mockReturnValue('parent-page-id');
    notionClient.findOrCreateChildPage.mockResolvedValue({
      pageId: 'daily-page-id',
      url: '',
    });
    await service.execute(baseInput);
    const call = notionClient.appendBlocks.mock.calls[0][0];
    expect(call.blocks).toHaveLength(1);
    expect(call.blocks[0].type).toBe('todo');
  });
});

describe('buildPushpinTaskBlocks', () => {
  it('cap 적용 — 600자 초과 시 잘리고 ellipsis 부착', () => {
    const long = 'a'.repeat(700);
    const blocks = buildPushpinTaskBlocks({ text: long, slackUserId: 'U1' });
    const todo = blocks[0];
    expect(todo.type).toBe('todo');
    if (todo.type === 'todo') {
      expect(todo.text.endsWith('…')).toBe(true);
      // 600 + "📌 (by <@U1>) " prefix + … 한 자.
      expect(todo.text.length).toBeLessThan(700);
    }
  });

  it('to-do block 의 checked=false 기본값', () => {
    const blocks = buildPushpinTaskBlocks({ text: 'hi', slackUserId: 'U1' });
    const todo = blocks[0];
    if (todo.type === 'todo') {
      expect(todo.checked).toBe(false);
    }
  });
});

describe('buildDailyChildPageTitle', () => {
  it('YYYY-MM-DD (요일) 포맷', () => {
    // 2026-06-01 은 KST 기준 월요일.
    expect(buildDailyChildPageTitle('2026-06-01')).toBe('2026-06-01 (월)');
  });
});
