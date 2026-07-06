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
