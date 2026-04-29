import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODE_GRAPH_SNAPSHOT_VERSION,
  CodeGraphSnapshot,
} from '../domain/code-graph.type';
import { CodeGraphSnapshotStore } from './code-graph.snapshot-store';

describe('CodeGraphSnapshotStore', () => {
  let workDir: string;
  let store: CodeGraphSnapshotStore;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'code-graph-store-'));
    store = new CodeGraphSnapshotStore();
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const sample = (): CodeGraphSnapshot => ({
    version: CODE_GRAPH_SNAPSHOT_VERSION,
    rootDir: '/repo',
    builtAt: '2026-04-29T00:00:00.000Z',
    chunks: [],
    relations: [],
  });

  it('save → load round-trip 으로 동일 snapshot 복원', async () => {
    const path = join(workDir, 'nested/dir/snapshot.json');
    const snapshot = sample();

    await store.save({ snapshot, path });
    const loaded = await store.load(path);

    expect(loaded).toEqual(snapshot);
  });

  it('파일 없으면 null', async () => {
    const loaded = await store.load(join(workDir, 'missing.json'));
    expect(loaded).toBeNull();
  });

  it('version 불일치면 null (forward-compat)', async () => {
    const path = join(workDir, 'old.json');
    await writeFile(
      path,
      JSON.stringify({ ...sample(), version: 999 }, null, 2),
    );

    const loaded = await store.load(path);
    expect(loaded).toBeNull();
  });

  it('손상된 JSON 이면 null (rebuild fallback)', async () => {
    const path = join(workDir, 'broken.json');
    await writeFile(path, '{not-json');

    const loaded = await store.load(path);
    expect(loaded).toBeNull();
  });

  it('필수 필드 누락이면 null', async () => {
    const path = join(workDir, 'missing-fields.json');
    await writeFile(
      path,
      JSON.stringify({ version: CODE_GRAPH_SNAPSHOT_VERSION }),
    );

    const loaded = await store.load(path);
    expect(loaded).toBeNull();
  });
});
