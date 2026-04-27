import { ConfigService } from '@nestjs/config';

import { NotionClientPort } from '../domain/port/notion-client.port';
import { ListActiveTasksUsecase } from './list-active-tasks.usecase';

describe('ListActiveTasksUsecase', () => {
  const buildConfig = (
    env: Record<string, string | undefined>,
  ): ConfigService =>
    ({
      get: jest.fn((key: string) => env[key]),
    }) as unknown as ConfigService;

  const buildClientMock = (
    fixture: ReturnType<NotionClientPort['listActiveTasks']> extends Promise<
      infer T
    >
      ? T
      : never,
  ): jest.Mocked<NotionClientPort> => ({
    listActiveTasks: jest.fn().mockResolvedValue(fixture),
    findOrCreateDailyPage: jest.fn(),
    appendBlocks: jest.fn(),
  });

  it('Notion client 호출 결과를 그대로 반환', async () => {
    const fixture = [
      {
        databaseId: 'DB1',
        pageId: 'p1',
        url: 'u',
        title: 't',
        properties: {},
      },
    ];
    const client = buildClientMock(fixture);
    const usecase = new ListActiveTasksUsecase(client, buildConfig({}));

    const result = await usecase.execute({ perDatabaseLimit: 10 });

    expect(result).toBe(fixture);
    expect(client.listActiveTasks).toHaveBeenCalledTimes(1);
    const callArg = client.listActiveTasks.mock.calls[0][0];
    expect(callArg).toMatchObject({ perDatabaseLimit: 10 });
    // OPS-6 default 60일 cutoff 자동 주입 — ISO 8601 datetime 형식
    expect(callArg?.lastEditedSinceIsoDateTime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('options 없이 호출하면 cutoff 만 전달', async () => {
    const client = buildClientMock([]);
    const usecase = new ListActiveTasksUsecase(client, buildConfig({}));

    await usecase.execute();

    expect(client.listActiveTasks).toHaveBeenCalledTimes(1);
    const callArg = client.listActiveTasks.mock.calls[0][0];
    expect(callArg?.lastEditedSinceIsoDateTime).toBeDefined();
  });

  it('OPS-6: 호출자가 lastEditedSinceIsoDateTime 명시하면 cutoff 덮어쓰지 않음', async () => {
    const client = buildClientMock([]);
    const usecase = new ListActiveTasksUsecase(
      client,
      buildConfig({ STALE_DATA_CUTOFF_DAYS: '14' }),
    );
    const explicit = '2025-01-01T00:00:00.000Z';

    await usecase.execute({ lastEditedSinceIsoDateTime: explicit });

    expect(
      client.listActiveTasks.mock.calls[0][0]?.lastEditedSinceIsoDateTime,
    ).toBe(explicit);
  });

  it('OPS-6: env STALE_DATA_CUTOFF_DAYS 가 cutoff 일수에 반영', async () => {
    const client = buildClientMock([]);
    const usecase = new ListActiveTasksUsecase(
      client,
      buildConfig({ STALE_DATA_CUTOFF_DAYS: '7' }),
    );

    await usecase.execute();

    const cutoff =
      client.listActiveTasks.mock.calls[0][0]?.lastEditedSinceIsoDateTime;
    const cutoffMs = new Date(cutoff!).getTime();
    const diffDays = (Date.now() - cutoffMs) / (24 * 60 * 60 * 1000);
    // 7일 ± 1일 (테스트 실행 시각의 분 단위 오차 허용)
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });
});
