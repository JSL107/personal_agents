import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractRepoSnapshot } from './repo-snapshot';

// GitHub tarball 과 같은 모양 — 최상위에 `<owner>-<repo>-<sha>/` 디렉터리 하나.
const makeTarball = async (
  entries: Record<string, string>,
  extraTarArgs: string[] = [],
): Promise<Buffer> => {
  const source = mkdtempSync(join(tmpdir(), 'repo-snapshot-spec-'));
  try {
    for (const [path, content] of Object.entries(entries)) {
      const target = join(source, path);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, content);
    }
    return execFileSync('tar', [
      '-czf',
      '-',
      ...extraTarArgs,
      '-C',
      source,
      ...readdirSync(source),
    ]);
  } finally {
    await rm(source, { recursive: true, force: true });
  }
};

const snapshotDirs = async (): Promise<string[]> =>
  readdirSync(await realpath(tmpdir())).filter((name) =>
    name.startsWith('idaeri-review-repo-'),
  );

describe('extractRepoSnapshot', () => {
  it('최상위 디렉터리를 벗겨 푼다', async () => {
    const tarball = await makeTarball({ 'o-r-abc/src/a.ts': 'export {};' });

    const snapshot = await extractRepoSnapshot(tarball);
    try {
      expect(readFileSync(join(snapshot.root, 'src/a.ts'), 'utf-8')).toBe(
        'export {};',
      );
    } finally {
      await snapshot.dispose();
    }
  });

  it('사본 밖을 가리키는 항목이 있으면 거부하고 임시 디렉터리를 남기지 않는다', async () => {
    const before = await snapshotDirs();
    // -s 로 경로를 바꿔 `../evil` 항목을 만든다(bsdtar).
    const tarball = await makeTarball({ 'o-r-abc/evil': 'x' }, [
      '-s',
      ',o-r-abc/evil,o-r-abc/../../evil,',
    ]);

    await expect(extractRepoSnapshot(tarball)).rejects.toThrow();
    expect(await snapshotDirs()).toEqual(before);
  });

  it('깨진 입력은 거부하고 임시 디렉터리를 남기지 않는다', async () => {
    const before = await snapshotDirs();

    await expect(
      extractRepoSnapshot(Buffer.from('not a tarball')),
    ).rejects.toThrow();
    expect(await snapshotDirs()).toEqual(before);
  });

  it('dispose 는 사본을 지운다', async () => {
    const tarball = await makeTarball({ 'o-r-abc/a.txt': 'x' });
    const snapshot = await extractRepoSnapshot(tarball);

    await snapshot.dispose();

    expect(existsSync(snapshot.root)).toBe(false);
  });
});
