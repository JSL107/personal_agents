import { MemoryIndexSnapshot } from '../domain/memory-index.type';
import { MemoryStorePort } from '../domain/port/memory-store.port';
import { MemoryVacuumService } from './memory-vacuum.service';

const snapshot: MemoryIndexSnapshot = {
  project: 'p',
  indexPath: '/tmp/p/MEMORY.md',
  indexContent: '- [있음](a.md)\n',
  files: [
    { fileName: 'a.md', title: '있음' },
    { fileName: 'b.md', title: '고아' },
  ],
};

const buildStore = (overrides: Partial<MemoryStorePort> = {}) => {
  const store: jest.Mocked<MemoryStorePort> = {
    loadSnapshots: jest.fn().mockResolvedValue([snapshot]),
    backup: jest.fn().mockResolvedValue('/tmp/p/MEMORY.md.bak-20260909'),
    writeIndex: jest.fn().mockResolvedValue(undefined),
    saveState: jest.fn().mockResolvedValue(undefined),
    loadState: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as jest.Mocked<MemoryStorePort>;
  return store;
};

describe('MemoryVacuumService', () => {
  it('apply=true 면 백업한 뒤 색인을 쓴다', async () => {
    const store = buildStore();
    const service = new MemoryVacuumService(store);

    const result = await service.run({ apply: true });

    expect(store.backup).toHaveBeenCalledTimes(1);
    expect(store.writeIndex).toHaveBeenCalledTimes(1);
    expect(result.failures).toEqual([]);
    expect(result.outcomes[0].actions).toContainEqual({
      type: 'orphan_indexed',
      count: 1,
    });
  });

  it('apply=false 면 진단만 하고 쓰지 않는다', async () => {
    const store = buildStore();
    const service = new MemoryVacuumService(store);

    const result = await service.run({ apply: false });

    expect(store.backup).not.toHaveBeenCalled();
    expect(store.writeIndex).not.toHaveBeenCalled();
    expect(result.outcomes[0].before.dust.orphans).toEqual(['b.md']);
  });

  it('백업이 실패하면 색인을 쓰지 않고 실패로 보고한다', async () => {
    // 되돌릴 수단 없이 쓰면 잘못된 청소를 복구할 방법이 사라진다.
    const store = buildStore({
      backup: jest.fn().mockRejectedValue(new Error('디스크 오류')),
    });
    const service = new MemoryVacuumService(store);

    const result = await service.run({ apply: true });

    expect(store.writeIndex).not.toHaveBeenCalled();
    expect(result.failures).toEqual([
      { project: 'p', reason: expect.stringContaining('백업 실패') },
    ]);
  });

  it('바꿀 것이 없으면 백업조차 하지 않는다', async () => {
    const store = buildStore({
      loadSnapshots: jest
        .fn()
        .mockResolvedValue([
          { ...snapshot, files: [{ fileName: 'a.md', title: '있음' }] },
        ]),
    });
    const service = new MemoryVacuumService(store);

    await service.run({ apply: true });

    expect(store.backup).not.toHaveBeenCalled();
    expect(store.writeIndex).not.toHaveBeenCalled();
  });
});
