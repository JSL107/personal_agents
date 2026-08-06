import { ConfigService } from '@nestjs/config';

import { NotionClientPort } from '../../notion/domain/port/notion-client.port';
import { PublishStudyBriefInput } from '../domain/port/study-brief-publisher.port';
import { StudyBriefNotionPublisher } from './study-brief-notion.publisher';

const buildNotionClient = (): jest.Mocked<NotionClientPort> => ({
  listActiveTasks: jest.fn(),
  createDatabasePage: jest.fn().mockResolvedValue({
    pageId: 'PAGE',
    url: 'https://notion.so/PAGE',
  }),
  findOrCreateDailyPage: jest.fn(),
  findOrCreateChildPage: jest.fn(),
  appendBlocks: jest.fn().mockResolvedValue(undefined),
  updatePageProperties: jest.fn(),
  replaceCheckInSection: jest.fn(),
  replaceAllBlocks: jest.fn(),
  archivePage: jest.fn().mockResolvedValue(undefined),
});

const buildConfig = (): ConfigService =>
  ({
    get: jest.fn((key: string) =>
      key === 'STUDY_BRIEF_NOTION_DATABASE_ID' ? 'DATABASE' : undefined,
    ),
  }) as unknown as ConfigService;

const buildLargeInput = (): PublishStudyBriefInput => ({
  kind: 'CONCEPT',
  topic: 'large report',
  verdict: {
    kind: 'CONCEPT',
    whyNow: 'why',
    whereItLands: 'where',
    readingPlan: 'read',
    minutes: 10,
  },
  reportMd: Array.from(
    { length: 205 },
    (_, index) => `paragraph ${index}`,
  ).join('\n'),
  sourceUrls: [],
  createdAt: new Date('2026-08-06T00:00:00.000Z'),
});

describe('StudyBriefNotionPublisher', () => {
  it('DB 속성과 CONCEPT callout, 본문, 링크 출처를 발행한다', async () => {
    const notionClient = buildNotionClient();
    const publisher = new StudyBriefNotionPublisher(
      notionClient,
      buildConfig(),
    );

    await expect(
      publisher.publish({
        kind: 'CONCEPT',
        topic: 'durable execution',
        verdict: {
          kind: 'CONCEPT',
          whyNow: '재시도 설계에 필요',
          whereItLands: 'agent-run',
          readingPlan: '공식 문서',
          minutes: 20,
        },
        reportMd: '## 세 줄 요약\n첫 문장',
        sourceUrls: ['https://example.com/doc'],
        createdAt: new Date('2026-08-05T16:00:00.000Z'),
      }),
    ).resolves.toEqual({
      pageId: 'PAGE',
      url: 'https://notion.so/PAGE',
    });

    const options = notionClient.createDatabasePage.mock.calls[0][0];
    expect(options.databaseId).toBe('DATABASE');
    expect(options.properties).toEqual({
      이름: {
        title: [{ type: 'text', text: { content: 'durable execution' } }],
      },
      종류: { select: { name: '개념' } },
      날짜: { date: { start: '2026-08-06' } },
      소요: { number: 20 },
      '출처 수': { number: 1 },
    });
    expect(options.blocks[0]).toMatchObject({ type: 'callout', icon: '📚' });
    expect(options.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'heading', text: '출처' }),
        expect.objectContaining({
          type: 'bullet',
          text: 'https://example.com/doc',
          link: 'https://example.com/doc',
        }),
      ]),
    );
    expect(JSON.stringify(options.blocks[0])).not.toContain('**');
    expect(JSON.stringify(options.blocks[0])).toContain('"bold":true');
    expect(notionClient.archivePage).not.toHaveBeenCalled();
  });

  it('첫 100개 뒤 블록을 appendBlocks로 100개씩 이어 붙인다', async () => {
    const notionClient = buildNotionClient();
    const publisher = new StudyBriefNotionPublisher(
      notionClient,
      buildConfig(),
    );
    await publisher.publish(buildLargeInput());

    expect(
      notionClient.createDatabasePage.mock.calls[0][0].blocks,
    ).toHaveLength(100);
    expect(notionClient.appendBlocks).toHaveBeenCalledTimes(2);
    expect(notionClient.appendBlocks.mock.calls[0][0].blocks).toHaveLength(100);
    expect(
      notionClient.appendBlocks.mock.calls[1][0].blocks.length,
    ).toBeLessThanOrEqual(100);
    expect(notionClient.archivePage).not.toHaveBeenCalled();
  });

  it('두 번째 appendBlocks가 실패하면 생성한 페이지를 archive하고 원래 오류를 던진다', async () => {
    const appendError = new Error('append rate limited');
    const notionClient = buildNotionClient();
    notionClient.appendBlocks
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(appendError);
    const publisher = new StudyBriefNotionPublisher(
      notionClient,
      buildConfig(),
    );

    await expect(publisher.publish(buildLargeInput())).rejects.toBe(
      appendError,
    );

    expect(notionClient.archivePage).toHaveBeenCalledWith({ pageId: 'PAGE' });
  });

  it('appendBlocks 실패 뒤 archive까지 실패해도 원래 append 오류를 던진다', async () => {
    const appendError = new Error('append network error');
    const notionClient = buildNotionClient();
    notionClient.appendBlocks
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(appendError);
    notionClient.archivePage.mockRejectedValueOnce(
      new Error('archive network error'),
    );
    const publisher = new StudyBriefNotionPublisher(
      notionClient,
      buildConfig(),
    );

    await expect(publisher.publish(buildLargeInput())).rejects.toBe(
      appendError,
    );
  });

  it('TOOL caution이 없으면 callout에서 주의 줄을 생략한다', async () => {
    const notionClient = buildNotionClient();
    const publisher = new StudyBriefNotionPublisher(
      notionClient,
      buildConfig(),
    );

    await publisher.publish({
      kind: 'TOOL',
      topic: 'context tool',
      verdict: {
        kind: 'TOOL',
        whatImproves: '검색 개선',
        adoptionCost: '낮음',
        installHint: 'codex mcp add',
        minutes: 10,
      },
      reportMd: '본문',
      sourceUrls: [],
      createdAt: new Date('2026-08-06T00:00:00.000Z'),
    });

    const callout = notionClient.createDatabasePage.mock.calls[0][0].blocks[0];
    expect(JSON.stringify(callout)).not.toContain('주의');
  });
});
