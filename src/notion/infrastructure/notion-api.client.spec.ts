import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@notionhq/client';

import { NotionException } from '../domain/notion.exception';
import { NotionWorkspace } from '../domain/notion.type';
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

  // 힌트 사전이 실제로 이 경로를 지나는지 — 겨냥한 조건(Notion APIResponseError)에서 확인한다.
  it('Notion 이 object_not_found 를 주면 실패 문구에 다음 행동이 붙는다', async () => {
    const notFound = Object.assign(new Error('Could not find page'), {
      code: 'object_not_found',
      status: 404,
    });
    const adapter = new NotionApiClient(
      {
        pages: { create: jest.fn().mockRejectedValue(notFound) },
      } as unknown as Client,
      buildConfig({}),
    );

    await expect(
      adapter.createDatabasePage({
        databaseId: 'DATABASE',
        properties: {},
        blocks: [],
      }),
    ).rejects.toMatchObject({
      notionErrorCode: NotionErrorCode.REQUEST_FAILED,
      message: expect.stringContaining('연결(Connections)'),
    });
  });

  // 대상 DB 가 전부 막히면 0건과 구분되지 않으므로 예외로 올린다 — 경고 로그는 그대로 남는다.
  it('대상 DB 가 전부 막히면 0건으로 삼키지 않고 예외를 올린다', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const notShared = Object.assign(new Error('Could not find database'), {
      code: 'object_not_found',
      status: 404,
    });
    const adapter = new NotionApiClient(
      {
        databases: { query: jest.fn().mockRejectedValue(notShared) },
      } as unknown as Client,
      buildConfig({}),
    );

    await expect(
      adapter.listActiveTasks({ databaseIds: ['DB1'] }),
    ).rejects.toMatchObject({
      notionErrorCode: NotionErrorCode.REQUEST_FAILED,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('연결(Connections)'),
    );
    warn.mockRestore();
  });

  // resolveTitlePropertyName 은 두 호출부 모두 try 밖에서 부른다 — 감싸지 않으면 원문이 샌다.
  it('DB schema 조회가 막히면 감싸서 다음 행동까지 붙인다', async () => {
    const notShared = Object.assign(new Error('Could not find database'), {
      code: 'object_not_found',
      status: 404,
    });
    const adapter = new NotionApiClient(
      {
        databases: { retrieve: jest.fn().mockRejectedValue(notShared) },
      } as unknown as Client,
      buildConfig({}),
    );

    await expect(
      adapter.createDatabasePage({
        databaseId: 'DATABASE',
        title: '제목',
        properties: {},
        blocks: [],
      }),
    ).rejects.toMatchObject({
      notionErrorCode: NotionErrorCode.REQUEST_FAILED,
      message: expect.stringContaining('연결(Connections)'),
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

  it('todo·bullet 의 children 을 부모 블록 안의 하위 블록으로 함께 보낸다', async () => {
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
      blocks: [
        {
          type: 'todo',
          text: '업로드 차단 해소',
          children: [{ type: 'bullet', text: '리뷰어 지정 (15m)' }],
        },
        { type: 'bullet', text: '하위 없음', children: [] },
      ],
    });

    const [todo, bullet] = create.mock.calls[0][0].children;
    expect(todo.to_do.children).toEqual([
      {
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [
            expect.objectContaining({
              text: expect.objectContaining({ content: '리뷰어 지정 (15m)' }),
            }),
          ],
        },
      },
    ]);
    // 하위가 비면 키를 싣지 않는다.
    expect(bullet.bulleted_list_item).not.toHaveProperty('children');
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

  it('페이지의 상태·보관·휴지통·수정 시각을 기존 목록과 같은 속성 값으로 읽는다', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      object: 'page',
      id: 'page-1',
      url: 'https://notion.so/page-1',
      archived: false,
      in_trash: true,
      last_edited_time: '2026-11-04T05:00:00.000Z',
      properties: {
        이름: { type: 'title', title: [{ plain_text: '업무' }] },
        상태: { type: 'status', status: { name: '완료' } },
        담당자: { type: 'people', people: [{ name: '김준석' }] },
      },
    });
    const adapter = new NotionApiClient(
      { pages: { retrieve } } as unknown as Client,
      buildConfig({}),
    );

    await expect(adapter.getPageStatus('page-1')).resolves.toEqual({
      properties: { 상태: '완료', 담당자: '김준석' },
      archived: false,
      inTrash: true,
      lastEditedTime: '2026-11-04T05:00:00.000Z',
    });
    expect(retrieve).toHaveBeenCalledWith({ page_id: 'page-1' });
  });

  it.each([404, 403])(
    '페이지 조회 %i는 접근 불가로 구분한다',
    async (status) => {
      const failure = Object.assign(new Error('Notion denied'), { status });
      const adapter = new NotionApiClient(
        {
          pages: { retrieve: jest.fn().mockRejectedValue(failure) },
        } as unknown as Client,
        buildConfig({}),
      );

      await expect(adapter.getPageStatus('page-1')).rejects.toHaveProperty(
        'name',
        'NotionPageNotAccessibleError',
      );
    },
  );

  // 통합은 자기 워크스페이스만 읽는다 — 회사 DB 는 회사 토큰 Client 로만 조회해야 한다.
  it('NOTION_WORK_TASK_DB_IDS 의 DB 는 회사 Client 로, 나머지는 개인 Client 로 조회한다', async () => {
    const personal = buildClient({ MINE: [] });
    const work = buildClient({ 'work-db': [] });
    const adapter = new NotionApiClient(
      personal,
      buildConfig({
        NOTION_TASK_DB_IDS: 'MINE',
        NOTION_WORK_TASK_DB_IDS: 'WORKDB',
      }),
      work,
    );

    await adapter.listActiveTasks({ databaseIds: ['MINE', 'work-db'] });
    await adapter.listActiveTasks();

    expect(
      (personal.databases.query as jest.Mock).mock.calls.map(
        ([options]) => options.database_id,
      ),
    ).toEqual(['MINE', 'MINE']);
    expect(
      (work.databases.query as jest.Mock).mock.calls.map(
        ([options]) => options.database_id,
      ),
    ).toEqual(['work-db', 'WORKDB']);
  });

  it('조회한 업무에 어느 워크스페이스 DB 에서 왔는지 붙인다', async () => {
    const row = (id: string): Record<string, unknown> => ({
      object: 'page',
      id,
      url: `https://notion.so/${id}`,
      properties: { 이름: { type: 'title', title: [{ plain_text: id }] } },
    });
    const adapter = new NotionApiClient(
      buildClient({ MINE: [row('mine-page')] }),
      buildConfig({
        NOTION_TASK_DB_IDS: 'MINE',
        NOTION_WORK_TASK_DB_IDS: 'WORKDB',
      }),
      buildClient({ WORKDB: [row('work-page')] }),
    );

    const tasks = await adapter.listActiveTasks();

    expect(tasks.map(({ pageId, workspace }) => [pageId, workspace])).toEqual([
      ['mine-page', NotionWorkspace.PERSONAL],
      ['work-page', NotionWorkspace.WORK],
    ]);
  });

  it('회사 토큰 없이 회사 DB 만 있으면 그 DB 는 실패로 센다', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const adapter = new NotionApiClient(
      buildClient({ MINE: [] }),
      buildConfig({
        NOTION_TASK_DB_IDS: 'MINE',
        NOTION_WORK_TASK_DB_IDS: 'WORKDB',
      }),
    );

    await expect(
      adapter.listActiveTasks({ requireAllDatabases: true }),
    ).rejects.toMatchObject({
      notionErrorCode: NotionErrorCode.REQUEST_FAILED,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('NOTION_WORK_TOKEN'),
    );
    warn.mockRestore();
  });

  // 회사 DB 에서 수집한 업무는 완료 판정 때 개인 Client 로는 404 — 회사 Client 로 다시 읽어야 닫힌다.
  it('개인 Client 가 페이지를 못 읽으면 회사 Client 로 상태를 읽는다', async () => {
    const denied = Object.assign(new Error('Could not find page'), {
      status: 404,
    });
    const workRetrieve = jest.fn().mockResolvedValue({
      object: 'page',
      id: 'page-1',
      url: 'https://notion.so/page-1',
      archived: false,
      in_trash: false,
      last_edited_time: '2026-11-04T05:00:00.000Z',
      properties: { 진행단계: { type: 'status', status: { name: '완료' } } },
    });
    const adapter = new NotionApiClient(
      {
        pages: { retrieve: jest.fn().mockRejectedValue(denied) },
      } as unknown as Client,
      buildConfig({}),
      { pages: { retrieve: workRetrieve } } as unknown as Client,
    );

    await expect(adapter.getPageStatus('page-1')).resolves.toMatchObject({
      properties: { 진행단계: '완료' },
    });

    workRetrieve.mockRejectedValue(denied);
    await expect(adapter.getPageStatus('page-1')).rejects.toHaveProperty(
      'name',
      'NotionPageNotAccessibleError',
    );
  });

  // 워크스페이스를 알면 그 통합으로만 묻는다 — 남의 통합으로 먼저 찌르면 SDK 가 매번 object_not_found 경고를 찍는다.
  it('회사 업무는 개인 Client 를 거치지 않고 회사 Client 로만 상태를 읽는다', async () => {
    const personalRetrieve = jest.fn();
    const workRetrieve = jest.fn().mockResolvedValue({
      object: 'page',
      id: 'page-1',
      url: 'https://notion.so/page-1',
      archived: false,
      in_trash: false,
      last_edited_time: '2026-11-04T05:00:00.000Z',
      properties: { 진행단계: { type: 'status', status: { name: '완료' } } },
    });
    const adapter = new NotionApiClient(
      { pages: { retrieve: personalRetrieve } } as unknown as Client,
      buildConfig({}),
      { pages: { retrieve: workRetrieve } } as unknown as Client,
    );

    await expect(
      adapter.getPageStatus('page-1', NotionWorkspace.WORK),
    ).resolves.toMatchObject({ properties: { 진행단계: '완료' } });
    expect(personalRetrieve).not.toHaveBeenCalled();
  });

  it('개인 업무는 개인 Client 가 못 읽어도 회사 Client 로 넘어가지 않는다', async () => {
    const denied = Object.assign(new Error('Could not find page'), {
      status: 404,
    });
    const workRetrieve = jest.fn();
    const adapter = new NotionApiClient(
      {
        pages: { retrieve: jest.fn().mockRejectedValue(denied) },
      } as unknown as Client,
      buildConfig({}),
      { pages: { retrieve: workRetrieve } } as unknown as Client,
    );

    await expect(
      adapter.getPageStatus('page-1', NotionWorkspace.PERSONAL),
    ).rejects.toHaveProperty('name', 'NotionPageNotAccessibleError');
    expect(workRetrieve).not.toHaveBeenCalled();
  });

  it('회사 업무인데 회사 토큰이 없으면 무엇이 빠졌는지 알린다', async () => {
    const adapter = new NotionApiClient(
      { pages: { retrieve: jest.fn() } } as unknown as Client,
      buildConfig({}),
      null,
    );

    await expect(
      adapter.getPageStatus('page-1', NotionWorkspace.WORK),
    ).rejects.toThrow('NOTION_WORK_TOKEN');
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

  it('전체 DB 성공을 요구하면 일부 DB 실패도 예외로 알린다', async () => {
    const query = jest.fn(({ database_id }) =>
      database_id === 'BAD'
        ? Promise.reject(new Error('object_not_found'))
        : Promise.resolve({ results: [] }),
    );
    const adapter = new NotionApiClient(
      { databases: { query } } as unknown as Client,
      buildConfig({}),
    );

    await expect(
      adapter.listActiveTasks({
        databaseIds: ['GOOD', 'BAD'],
        requireAllDatabases: true,
      }),
    ).rejects.toMatchObject({
      notionErrorCode: NotionErrorCode.REQUEST_FAILED,
    });
    expect(query).toHaveBeenCalledTimes(2);
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
      '## 제목\n\n```typescript\nconst page = 1;\n```\n\n```typescript\nconst page = 2;\n```',
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

  const buildPagedQuery = (pageCount: number): jest.Mock =>
    jest.fn().mockImplementation(({ start_cursor }) => {
      const pageNumber = start_cursor
        ? Number(start_cursor.replace('cursor-', ''))
        : 0;
      const hasMore = pageNumber < pageCount - 1;
      return Promise.resolve({
        results: [
          {
            id: `p${pageNumber}`,
            url: 'u',
            properties: {
              Title: {
                type: 'title',
                title: [{ plain_text: `t${pageNumber}` }],
              },
            },
          },
        ],
        has_more: hasMore,
        next_cursor: hasMore ? `cursor-${pageNumber + 1}` : null,
      });
    });

  it('DB 조회는 next_cursor 를 따라 끝까지 읽는다', async () => {
    const query = buildPagedQuery(3);
    const adapter = new NotionApiClient(
      { databases: { query } } as unknown as Client,
      buildConfig({}),
    );

    const tasks = await adapter.listActiveTasks({
      databaseIds: ['DB1'],
      perDatabaseLimit: 1000,
    });

    expect(tasks.map((task) => task.pageId)).toEqual(['p0', 'p1', 'p2']);
    expect(query.mock.calls.map(([input]) => input.start_cursor)).toEqual([
      undefined,
      'cursor-1',
      'cursor-2',
    ]);
    expect(query.mock.calls[0][0].page_size).toBe(100);
  });

  it('DB 조회는 perDatabaseLimit 에서 멈추고 전수 호출자에게만 잘림을 경고한다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const query = buildPagedQuery(10);
    const adapter = new NotionApiClient(
      { databases: { query } } as unknown as Client,
      buildConfig({}),
    );

    const tasks = await adapter.listActiveTasks({
      databaseIds: ['DB1'],
      perDatabaseLimit: 2,
      requireAllDatabases: true,
    });

    expect(tasks).toHaveLength(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0].page_size).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('한도에서 잘렸습니다'),
    );
    warn.mockClear();

    // 상한이 의도인 일반 호출자는 경고하지 않는다.
    await adapter.listActiveTasks({
      databaseIds: ['DB1'],
      perDatabaseLimit: 2,
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
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

// 같은 페이지의 교체 작업은 페이지별 사슬로 한 줄로 선다. 이 사슬은 세 번 고쳐진 자리라(N≥3 이면 첫 건만
// 직렬화되던 race, finally 를 별도 promise 로 분기해 생긴 unhandled rejection) 동시 호출로 직접 확인한다.
describe('페이지별 교체 직렬화', () => {
  // 바깥에서 풀 수 있는 promise — 첫 호출의 append 를 붙잡아 두고 그동안 다른 호출이 끼어드는지 본다.
  const deferred = (): {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  } => {
    let resolve = (): void => undefined;
    let reject = (error: Error): void => void error;
    const promise = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    return { promise, resolve, reject };
  };
  const flush = async (): Promise<void> => {
    for (let index = 0; index < 10; index += 1) {
      await Promise.resolve();
    }
  };
  const buildBlockClient = (append: jest.Mock) => {
    const list = jest.fn().mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    });
    const client = {
      blocks: { children: { list, append }, delete: jest.fn() },
    };
    return {
      list,
      adapter: new NotionApiClient(client as never, {} as never),
    };
  };
  const blocks = [{ type: 'heading' as const, text: 'H' }];

  it.each(['replaceAllBlocks', 'replaceCheckInSection'] as const)(
    '%s — 같은 페이지 세 번 동시 호출은 하나씩 차례로 실행된다',
    async (method) => {
      const first = deferred();
      const second = deferred();
      const append = jest
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
        .mockResolvedValue({});
      const { list, adapter } = buildBlockClient(append);

      const calls = [1, 2, 3].map(() =>
        adapter[method]({ pageId: 'PAGE', blocks }),
      );
      await flush();
      // 첫 호출이 append 에서 멈춘 동안 두 번째·세 번째는 기존 블록 조회조차 시작하지 않는다.
      expect(list).toHaveBeenCalledTimes(1);

      // 예전 버그는 "첫 호출만 기다리기" 였다 — 첫 호출이 끝나면 2·3번째가 함께 풀려 겹쳤다.
      // 두 번째를 붙잡아 둔 동안 세 번째가 시작하지 않아야 사슬이 끝까지 이어진 것이다.
      first.resolve();
      await flush();
      expect(list).toHaveBeenCalledTimes(2);

      second.resolve();
      await Promise.all(calls);
      expect(list).toHaveBeenCalledTimes(3);
      expect(append).toHaveBeenCalledTimes(3);
    },
  );

  it.each(['replaceAllBlocks', 'replaceCheckInSection'] as const)(
    '%s — 앞 호출이 실패해도 뒤 호출은 실행된다',
    async (method) => {
      const append = jest
        .fn()
        .mockRejectedValueOnce(new Error('append 실패'))
        .mockResolvedValue({});
      const { adapter } = buildBlockClient(append);

      const failed = adapter[method]({ pageId: 'PAGE', blocks });
      const next = adapter[method]({ pageId: 'PAGE', blocks });

      await expect(failed).rejects.toThrow();
      await expect(next).resolves.toBeUndefined();
      expect(append).toHaveBeenCalledTimes(2);
    },
  );

  it('다른 페이지끼리는 서로 기다리지 않는다', async () => {
    const first = deferred();
    const append = jest
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({});
    const { list, adapter } = buildBlockClient(append);

    const slow = adapter.replaceAllBlocks({ pageId: 'PAGE-A', blocks });
    const other = adapter.replaceAllBlocks({ pageId: 'PAGE-B', blocks });
    await expect(other).resolves.toBeUndefined();
    expect(list).toHaveBeenCalledTimes(2);

    first.resolve();
    await slow;
  });
});
