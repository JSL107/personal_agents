import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { MemoryIndexSnapshot } from '../domain/memory-index.type';
import { MemoryStoreFsAdapter } from './memory-store.fs.adapter';

const buildAdapter = (root: string): MemoryStoreFsAdapter => {
  const configService = {
    get: (key: string): string | undefined =>
      key === 'MEMORY_VACUUM_PROJECTS_ROOT' ? root : undefined,
  } as unknown as ConfigService;
  return new MemoryStoreFsAdapter(configService);
};

describe('MemoryStoreFsAdapter', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'memory-vacuum-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const writeProject = async (
    project: string,
    files: Record<string, string>,
  ): Promise<string> => {
    const dir = join(root, project, 'memory');
    await fs.mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(join(dir, name), content, 'utf8');
    }
    return dir;
  };

  it('memory 디렉터리가 있는 프로젝트만 읽는다', async () => {
    await writeProject('with-memory', { 'a.md': 'x' });
    await fs.mkdir(join(root, 'no-memory'), { recursive: true });

    const snapshots = await buildAdapter(root).loadSnapshots();

    expect(snapshots.map((snapshot) => snapshot.project)).toEqual([
      'with-memory',
    ]);
  });

  it('색인 자신과 백업 파일은 기억 파일로 세지 않는다', async () => {
    // 백업(.bak-YYYYMMDD)을 기억으로 세면 청소기가 자기 백업을 고아로 등록한다.
    await writeProject('p', {
      'MEMORY.md': '- [a](a.md)\n',
      'MEMORY.md.bak-20260909': 'old',
      'a.md': 'x',
    });

    const [snapshot] = await buildAdapter(root).loadSnapshots();

    expect(snapshot.files.map((file) => file.fileName)).toEqual(['a.md']);
  });

  it('frontmatter description 에서 색인 제목을 뽑는다', async () => {
    await writeProject('p', {
      'a.md': '---\ndescription: 핵심 교훈 — 부연 설명\n---\n본문',
    });

    const [snapshot] = await buildAdapter(root).loadSnapshots();

    expect(snapshot.files[0].title).toBe('핵심 교훈');
  });

  it('같은 날 두 번째 백업이 첫 백업을 덮어쓰지 않는다', async () => {
    // 이걸 덮어쓰면 청소 전 원본이 사라져 되돌릴 수 없다.
    const dir = await writeProject('p', { 'MEMORY.md': '원본', 'a.md': 'x' });
    const adapter = buildAdapter(dir.length > 0 ? root : root);
    const snapshot: MemoryIndexSnapshot = {
      project: 'p',
      indexPath: join(dir, 'MEMORY.md'),
      indexContent: '원본',
      files: [],
    };

    const first = await adapter.backup(snapshot);
    const second = await adapter.backup({
      ...snapshot,
      indexContent: '청소된 뒤 내용',
    });

    expect(second).toBe(first);
    await expect(fs.readFile(first, 'utf8')).resolves.toBe('원본');
  });

  it('실태 파일을 쓰고 다시 읽는다', async () => {
    const adapter = buildAdapter(root);
    const state = {
      ranAtIso: '2026-09-09T00:00:00.000Z',
      projectCount: 14,
      cleanedCount: 110,
      pendingProjects: 2,
    };

    await adapter.saveState(state);

    await expect(adapter.loadState()).resolves.toEqual(state);
  });

  it('깨진 실태 파일은 null 로 수렴한다', async () => {
    await fs.writeFile(
      join(root, '.memory-vacuum-state.json'),
      '{ 깨진 JSON',
      'utf8',
    );

    await expect(buildAdapter(root).loadState()).resolves.toBeNull();
  });
});
