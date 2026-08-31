import { ConfigService } from '@nestjs/config';
import { Client } from '@notionhq/client';

import { NotionException } from '../domain/notion.exception';
import { NotionErrorCode } from '../domain/notion-error-code.enum';
import { NotionApiClient } from './notion-api.client';

describe('NotionApiClient', () => {
  const buildConfig = (env: Record<string, string>): ConfigService =>
    ({
      get: jest.fn((key: string) => env[key]),
    }) as unknown as ConfigService;

  const buildClient = (
    queryByDb: Record<string, Array<Record<string, unknown>>>,
  ): Client =>
    ({
      databases: {
        query: jest.fn(({ database_id }) =>
          Promise.resolve({ results: queryByDb[database_id] ?? [] }),
        ),
      },
    }) as unknown as Client;

  it('Notion client 가 null 이면 TOKEN_NOT_CONFIGURED 예외', async () => {
    const adapter = new NotionApiClient(null, buildConfig({}));

    await expect(adapter.listActiveTasks()).rejects.toMatchObject({
      notionErrorCode: NotionErrorCode.TOKEN_NOT_CONFIGURED,
    });
  });

  it('DB page를 properties와 최대 100개 children으로 생성한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'PAGE',
      url: 'https://notion.so/PAGE',
    });
    const adapter = new NotionApiClient(
      { pages: { create } } as unknown as Client,
      buildConfig({}),
    );

    const page = await adapter.createDatabasePage({
      databaseId: 'DATABASE',
      properties: { 이름: { title: [] } },
      blocks: Array.from({ length: 101 }, (_, index) => ({
        type: 'paragraph',
        text: `block ${index}`,
        richText: [],
      })),
    });

    expect(page).toEqual({
      pageId: 'PAGE',
      url: 'https://notion.so/PAGE',
    });
    expect(create).toHaveBeenCalledWith({
      parent: { database_id: 'DATABASE' },
      properties: { 이름: { title: [] } },
      children: expect.any(Array),
    });
    expect(create.mock.calls[0][0].children).toHaveLength(100);
  });

  it('image 블록을 file_upload 참조로 변환한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'page-1',
      url: 'https://notion.so/page-1',
      properties: {},
    });
    const adapter = new NotionApiClient(
      { pages: { create } } as unknown as Client,
      buildConfig({}),
    );

    await adapter.createDatabasePage({
      databaseId: 'db-1',
      properties: {},
      blocks: [{ type: 'image', fileUploadId: 'upload-1' }],
    });

    expect(create.mock.calls[0][0].children[0]).toEqual({
      object: 'block',
      type: 'image',
      image: { type: 'file_upload', file_upload: { id: 'upload-1' } },
    });
  });

  it('page를 archived 상태로 갱신한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const adapter = new NotionApiClient(
      { pages: { update } } as unknown as Client,
      buildConfig({}),
    );

    await adapter.archivePage({ pageId: 'PAGE' });

    expect(update).toHaveBeenCalledWith({
      page_id: 'PAGE',
      archived: true,
    });
  });

  it('NOTION_TASK_DB_IDS env 가 없고 인자도 없으면 빈 배열 반환 (graceful)', async () => {
    const client = buildClient({});
    const adapter = new NotionApiClient(client, buildConfig({}));

    const tasks = await adapter.listActiveTasks();

    expect(tasks).toEqual([]);
  });

  it('한 DB 의 page 들을 NotionTask 로 매핑 — title + 다양한 property string 화', async () => {
    const client = buildClient({
      DB1: [
        {
          id: 'page-1',
          url: 'https://notion.so/p1',
          properties: {
            이름: {
              type: 'title',
              title: [{ plain_text: '버그 ' }, { plain_text: '수정' }],
            },
            상태: { type: 'status', status: { name: '진행중' } },
            우선순위: { type: 'select', select: { name: '높음' } },
            담당자: {
              type: 'people',
              people: [{ name: '김준석' }, { id: 'u2' }],
            },
            태그: {
              type: 'multi_select',
              multi_select: [{ name: 'bug' }, { name: 'p1' }],
            },
            완료: { type: 'checkbox', checkbox: false },
            일정: {
              type: 'date',
              date: { start: '2026-04-24', end: '2026-04-25' },
            },
            번호: {
              type: 'unique_id',
              unique_id: { prefix: 'TSK', number: 7 },
            },
          },
        },
      ],
    });
    const adapter = new NotionApiClient(client, buildConfig({}));

    const tasks = await adapter.listActiveTasks({ databaseIds: ['DB1'] });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      databaseId: 'DB1',
      pageId: 'page-1',
      url: 'https://notion.so/p1',
      title: '버그 수정',
    });
    expect(tasks[0].properties).toEqual({
      상태: '진행중',
      우선순위: '높음',
      담당자: '김준석, u2',
      태그: 'bug, p1',
      완료: '✗',
      일정: '2026-04-24 → 2026-04-25',
      번호: 'TSK-7',
    });
  });

  it('한 DB 호출 실패해도 다른 DB 는 계속 처리 (graceful skip)', async () => {
    const query = jest.fn(({ database_id }) => {
      if (database_id === 'BAD') {
        return Promise.reject(new Error('object_not_found'));
      }
      return Promise.resolve({
        results: [
          {
            id: 'p',
            url: 'u',
            properties: {
              Title: { type: 'title', title: [{ plain_text: 'ok' }] },
            },
          },
        ],
      });
    });
    const client = {
      databases: { query },
    } as unknown as Client;
    const adapter = new NotionApiClient(client, buildConfig({}));

    const tasks = await adapter.listActiveTasks({
      databaseIds: ['BAD', 'GOOD'],
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].databaseId).toBe('GOOD');
  });

  it('env 에서 콤마 구분 NOTION_TASK_DB_IDS 를 trim 해서 사용', async () => {
    const query = jest.fn((args: { database_id: string }) =>
      // args 는 검증 목적 — body 에서 무시해도 jest.Mock signature 에 등록되도록 받는다.
      Promise.resolve({ results: [] as unknown[], _seen: args }),
    );
    const client = { databases: { query } } as unknown as Client;
    const adapter = new NotionApiClient(
      client,
      buildConfig({ NOTION_TASK_DB_IDS: ' DB1 , DB2 ,DB3' }),
    );

    await adapter.listActiveTasks();

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.map((c) => c[0].database_id)).toEqual([
      'DB1',
      'DB2',
      'DB3',
    ]);
  });

  it('빈 properties (제목 없음 / 알려지지 않은 property type 만) 도 안전 처리', async () => {
    const client = buildClient({
      DB1: [
        {
          id: 'p',
          url: 'u',
          properties: {
            Title: { type: 'title', title: [] },
            Files: { type: 'files', files: [{ name: 'a.png' }] },
          },
        },
      ],
    });
    const adapter = new NotionApiClient(client, buildConfig({}));

    const [task] = await adapter.listActiveTasks({ databaseIds: ['DB1'] });

    expect(task.title).toBe('(제목 없음)');
    // files 는 알려지지 않은 type 이라 properties 에 포함 안 됨.
    expect(task.properties).toEqual({});
  });

  it('초안 page를 상태 필터, 생성일 오름차순, 기본 20개 제한과 env 속성명으로 조회한다', async () => {
    const query = jest.fn().mockResolvedValue({
      results: [
        {
          id: 'draft-page',
          url: 'https://notion.so/draft-page',
          created_time: '2026-08-14T01:02:03.000Z',
          properties: {
            제목: {
              type: 'title',
              title: [{ plain_text: '블로그 ' }, { plain_text: '초안' }],
            },
            카테고리: { type: 'select', select: { name: '개발 회고' } },
            출처유형: { type: 'select', select: { name: 'PR' } },
            Topics: {
              type: 'multi_select',
              multi_select: [{ name: 'nestjs' }, { name: 'notion' }],
            },
            Summary: {
              type: 'rich_text',
              rich_text: [{ plain_text: '요약 ' }, { plain_text: '내용' }],
            },
          },
        },
      ],
    });
    const adapter = new NotionApiClient(
      { databases: { query } } as unknown as Client,
      buildConfig({
        BLOG_NOTION_PROP_TAGS: 'Topics',
        BLOG_NOTION_PROP_SUMMARY: 'Summary',
      }),
    );

    const pages = await adapter.queryDraftPages({
      databaseId: 'BLOG_DATABASE',
      statusPropertyName: '상태',
      statusValue: '초안',
    });

    expect(query).toHaveBeenCalledWith({
      database_id: 'BLOG_DATABASE',
      filter: { property: '상태', select: { equals: '초안' } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 20,
    });
    expect(pages).toEqual([
      {
        pageId: 'draft-page',
        url: 'https://notion.so/draft-page',
        title: '블로그 초안',
        category: '개발 회고',
        sourceType: 'PR',
        tags: ['nestjs', 'notion'],
        summary: '요약 내용',
        createdTime: '2026-08-14T01:02:03.000Z',
      },
    ]);
  });

  it('초안 page 속성이 없거나 타입이 다르면 빈 값으로 안전하게 처리한다', async () => {
    const query = jest.fn().mockResolvedValue({
      results: [
        {
          id: 'draft-page',
          url: 'https://notion.so/draft-page',
          properties: {
            제목: { type: 'select', select: { name: '제목 아님' } },
            카테고리: { type: 'rich_text', rich_text: [] },
            출처유형: { type: 'status', status: { name: '초안' } },
            태그: { type: 'select', select: { name: '태그 아님' } },
            요약: { type: 'select', select: { name: '요약 아님' } },
          },
        },
        { object: 'page', id: 'partial-page' },
      ],
    });
    const adapter = new NotionApiClient(
      { databases: { query } } as unknown as Client,
      buildConfig({}),
    );

    const pages = await adapter.queryDraftPages({
      databaseId: 'BLOG_DATABASE',
      statusPropertyName: '상태',
      statusValue: '초안',
      limit: 3,
    });

    expect(query).toHaveBeenCalledWith({
      database_id: 'BLOG_DATABASE',
      filter: { property: '상태', select: { equals: '초안' } },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 3,
    });
    expect(pages).toEqual([
      {
        pageId: 'draft-page',
        url: 'https://notion.so/draft-page',
        title: '',
        category: '',
        sourceType: '',
        tags: [],
        summary: '',
        createdTime: '',
      },
    ]);
  });

  const buildPagedList = (lastPage: number): jest.Mock =>
    jest.fn().mockImplementation(({ start_cursor }) => {
      const pageNumber = start_cursor
        ? Number(start_cursor.replace('cursor-', ''))
        : 0;
      return Promise.resolve({
        results: [
          pageNumber === 0
            ? {
                type: 'heading_2',
                heading_2: { rich_text: [{ plain_text: '제목' }] },
              }
            : {
                type: 'code',
                code: {
                  language: 'typescript',
                  rich_text: [{ plain_text: `const page = ${pageNumber};` }],
                },
              },
        ],
        has_more: pageNumber < lastPage,
        next_cursor: pageNumber < lastPage ? `cursor-${pageNumber + 1}` : null,
      });
    });

  it('페이지 block을 cursor 페이지네이션해 끝까지 읽고 마크다운으로 변환한다', async () => {
    const list = buildPagedList(2);
    const adapter = new NotionApiClient(
      { blocks: { children: { list } } } as unknown as Client,
      buildConfig({}),
    );

    const markdown = await adapter.getPageMarkdown('draft-page');

    expect(list).toHaveBeenCalledTimes(3);
    expect(list.mock.calls.map(([input]) => input)).toEqual([
      { block_id: 'draft-page', start_cursor: undefined, page_size: 100 },
      { block_id: 'draft-page', start_cursor: 'cursor-1', page_size: 100 },
      { block_id: 'draft-page', start_cursor: 'cursor-2', page_size: 100 },
    ]);
    expect(markdown).toBe(
      '# 제목\n\n```typescript\nconst page = 1;\n```\n\n```typescript\nconst page = 2;\n```',
    );
  });

  // 잘린 본문을 정상 Markdown 으로 넘기면 승인 단계가 뒷부분 유실을 알아채지 못한다.
  it('조회 상한에 걸린 뒤에도 block이 남아 있으면 잘린 본문 대신 실패한다', async () => {
    const list = buildPagedList(Number.POSITIVE_INFINITY);
    const adapter = new NotionApiClient(
      { blocks: { children: { list } } } as unknown as Client,
      buildConfig({}),
    );

    await expect(adapter.getPageMarkdown('draft-page')).rejects.toThrow(
      '조회 상한',
    );
    expect(list).toHaveBeenCalledTimes(5);
  });

  it('NotionException 는 Notion API 외 호출자 에러도 잘 형성 (sanity)', () => {
    const ex = new NotionException({
      code: NotionErrorCode.REQUEST_FAILED,
      message: 'x',
    });
    expect(ex.notionErrorCode).toBe(NotionErrorCode.REQUEST_FAILED);
  });
});

describe('replaceAllBlocks', () => {
  it('기존 child block 을 모두 archive 하고 신규 blocks 를 append 한다 (append 가 먼저)', async () => {
    const list = jest.fn().mockResolvedValue({
      results: [{ id: 'b1' }, { id: 'b2' }],
      has_more: false,
      next_cursor: null,
    });
    const append = jest.fn().mockResolvedValue({});
    const del = jest.fn().mockResolvedValue({});
    const client = {
      blocks: { children: { list, append }, delete: del },
    };
    const adapter = new NotionApiClient(client as never, {} as never);

    await adapter.replaceAllBlocks({
      pageId: 'PAGE',
      blocks: [{ type: 'heading', text: 'H' }],
    });

    expect(append).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith({ block_id: 'b1' });
    expect(del).toHaveBeenCalledWith({ block_id: 'b2' });
    // 신규 append 가 기존 archive 보다 먼저 — append 실패 시 기존 보존.
    expect(append.mock.invocationCallOrder[0]).toBeLessThan(
      del.mock.invocationCallOrder[0],
    );
  });
});
