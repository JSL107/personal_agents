import { NotionTask } from '../../notion/domain/notion.type';
import type { NotionClientPort } from '../../notion/domain/port/notion-client.port';
import { NotionStateSource } from './notion-state-source';

describe('NotionStateSource', () => {
  const buildClient = (listActiveTasks: jest.Mock): NotionClientPort =>
    ({ listActiveTasks }) as unknown as NotionClientPort;

  const buildTask = (overrides: Partial<NotionTask> = {}): NotionTask =>
    ({
      pageId: 'page-1',
      databaseId: 'DB1',
      url: 'https://notion.so/p1',
      title: '작업 하나',
      properties: { 상태: '진행 중' },
      ...overrides,
    }) as NotionTask;

  // 회귀 방지 본체 — 컷오프(lastEditedSinceIsoDateTime) 를 걸면 항목이 나이를 먹는 날마다
  // 조회에서 빠지고 diffSnapshots 가 그것을 removed 로 판정한다. 상태 비교에는 이동 창을 걸지 않는다.
  it('조회에 stale 컷오프를 걸지 않는다', async () => {
    const listActiveTasks = jest.fn().mockResolvedValue([]);
    const source = new NotionStateSource(buildClient(listActiveTasks));

    await source.fetchSnapshot();

    expect(listActiveTasks).toHaveBeenCalledTimes(1);
    const passedOptions = listActiveTasks.mock.calls[0][0];
    expect(passedOptions?.lastEditedSinceIsoDateTime).toBeUndefined();
  });

  it('task 를 상태+제목 지문으로 접어 snapshot 을 만든다', async () => {
    const source = new NotionStateSource(
      buildClient(jest.fn().mockResolvedValue([buildTask()])),
    );

    const snapshot = await source.fetchSnapshot();

    expect(snapshot.sourceId).toBe('notion');
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].key).toBe('notion:page-1');
    expect(snapshot.items[0].summary).toBe('작업 하나');
  });

  // 묵은 항목이 무해한 근거 — 내용이 그대로면 지문도 그대로라 contentHash 가 같고,
  // diffSnapshots 가 변화 없음으로 즉시 반환해 gate 를 부르지 않는다.
  it('내용이 그대로면 회차가 달라도 contentHash 가 같다', async () => {
    const first = await new NotionStateSource(
      buildClient(jest.fn().mockResolvedValue([buildTask()])),
    ).fetchSnapshot();
    const second = await new NotionStateSource(
      buildClient(jest.fn().mockResolvedValue([buildTask()])),
    ).fetchSnapshot();

    expect(second.contentHash).toBe(first.contentHash);
  });

  it('같은 page 라도 상태가 바뀌면 지문이 갈린다', async () => {
    const before = await new NotionStateSource(
      buildClient(jest.fn().mockResolvedValue([buildTask()])),
    ).fetchSnapshot();
    const after = await new NotionStateSource(
      buildClient(
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
    const source = new NotionStateSource(
      buildClient(jest.fn().mockRejectedValue(new Error('조회 실패'))),
    );

    await expect(source.fetchSnapshot()).rejects.toThrow('조회 실패');
  });
});
