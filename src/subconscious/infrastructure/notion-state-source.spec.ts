import { ListActiveTasksUsecase } from '../../notion/application/list-active-tasks.usecase';
import { NotionTask } from '../../notion/domain/notion.type';
import { NotionStateSource } from './notion-state-source';

describe('NotionStateSource', () => {
  const buildUsecase = (execute: jest.Mock): ListActiveTasksUsecase =>
    ({ execute }) as unknown as ListActiveTasksUsecase;

  const buildTask = (overrides: Partial<NotionTask> = {}): NotionTask =>
    ({
      pageId: 'page-1',
      databaseId: 'DB1',
      url: 'https://notion.so/p1',
      title: '작업 하나',
      properties: { 상태: '진행 중' },
      ...overrides,
    }) as NotionTask;

  // 회귀 방지 본체 — 포트를 직접 부르면 STALE_DATA_CUTOFF_DAYS 가 통째로 우회된다.
  // usecase 를 거치는지를 호출로 못박아 둔다 (PM / PO Shadow 와 같은 컷오프).
  it('포트가 아니라 ListActiveTasksUsecase 를 거쳐 조회한다', async () => {
    const execute = jest.fn().mockResolvedValue([]);
    const source = new NotionStateSource(buildUsecase(execute));

    await source.fetchSnapshot();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('task 를 상태+제목 지문으로 접어 snapshot 을 만든다', async () => {
    const execute = jest.fn().mockResolvedValue([buildTask()]);
    const source = new NotionStateSource(buildUsecase(execute));

    const snapshot = await source.fetchSnapshot();

    expect(snapshot.sourceId).toBe('notion');
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].key).toBe('notion:page-1');
    expect(snapshot.items[0].summary).toBe('작업 하나');
  });

  // 상태가 바뀌면 지문이 갈려야 변화로 잡힌다 — 제목만 같아도 같은 지문이면 안 된다.
  it('같은 page 라도 상태가 바뀌면 지문이 갈린다', async () => {
    const before = await new NotionStateSource(
      buildUsecase(jest.fn().mockResolvedValue([buildTask()])),
    ).fetchSnapshot();
    const after = await new NotionStateSource(
      buildUsecase(
        jest
          .fn()
          .mockResolvedValue([buildTask({ properties: { 상태: '완료' } })]),
      ),
    ).fetchSnapshot();

    expect(after.items[0].fingerprint).not.toBe(before.items[0].fingerprint);
  });

  // 조회가 실패하면 삼키지 않고 올린다 — engine 이 baseline 전진을 건너뛰어야
  // 권한 단절이 "항목 전부 사라짐" 으로 읽히지 않는다.
  it('조회 실패를 삼키지 않고 그대로 올린다', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('조회 실패'));
    const source = new NotionStateSource(buildUsecase(execute));

    await expect(source.fetchSnapshot()).rejects.toThrow('조회 실패');
  });
});
