import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildTarball } from '../domain/__fixtures__/tar-archive';
import { extractRepoSnapshot } from './repo-snapshot';

// GitHub tarball 과 같은 모양 — 최상위에 `<owner>-<repo>-<sha>/` 디렉터리 하나.
const TOP = 'o-r-abc';

const snapshotDirs = async (): Promise<string[]> =>
  readdirSync(await realpath(tmpdir())).filter((name) =>
    name.startsWith('idaeri-review-repo-'),
  );

describe('extractRepoSnapshot', () => {
  it('최상위 디렉터리를 벗겨 tmpdir 아래에 푼다', async () => {
    const tarball = buildTarball({
      entries: [
        { path: `${TOP}/`, type: '5' },
        { path: `${TOP}/src/`, type: '5' },
        { path: `${TOP}/src/a.ts`, body: 'export {};' },
      ],
    });

    const snapshot = await extractRepoSnapshot({ tarball });
    try {
      expect(snapshot.root.startsWith(tmpdir())).toBe(true);
      expect(readFileSync(join(snapshot.root, 'src/a.ts'), 'utf-8')).toBe(
        'export {};',
      );
    } finally {
      await snapshot.dispose();
    }
  });

  // 링크를 먼저 풀고 그 아래로 파일을 쓰게 하면 사본 밖에 쓴다. 시스템 tar 종류와 무관하게 막혀야 한다.
  it('사본 밖을 가리키는 링크를 거쳐 쓰는 tarball 은 풀지 않고, 밖에 아무것도 쓰지 않는다', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'repo-snapshot-outside-'));
    try {
      const tarball = buildTarball({
        entries: [
          { path: `${TOP}/`, type: '5' },
          { path: `${TOP}/link`, type: '2', linkPath: outside },
          { path: `${TOP}/link/x`, body: 'pwn' },
        ],
      });
      const before = await snapshotDirs();

      await expect(extractRepoSnapshot({ tarball })).rejects.toThrow(
        '링크 대상이 절대경로다',
      );
      expect(readdirSync(outside)).toEqual([]);
      expect(await snapshotDirs()).toEqual(before);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('`..` 항목이 있으면 풀지 않는다', async () => {
    const before = await snapshotDirs();
    const tarball = buildTarball({
      entries: [{ path: `${TOP}/../../evil`, body: 'x' }],
    });

    await expect(extractRepoSnapshot({ tarball })).rejects.toThrow(
      '경로가 사본 밖을 가리킨다',
    );
    expect(await snapshotDirs()).toEqual(before);
  });

  it('풀린 크기가 상한을 넘으면 디렉터리를 만들지 않고 거부한다', async () => {
    const tarball = buildTarball({
      entries: [{ path: `${TOP}/big.txt`, body: 'x'.repeat(4096) }],
    });
    const before = await snapshotDirs();

    await expect(
      extractRepoSnapshot({ tarball, maxExtractedBytes: 1024 }),
    ).rejects.toThrow();
    expect(await snapshotDirs()).toEqual(before);
  });

  it('깨진 입력은 거부하고 임시 디렉터리를 남기지 않는다', async () => {
    const before = await snapshotDirs();

    await expect(
      extractRepoSnapshot({ tarball: Buffer.from('not a tarball') }),
    ).rejects.toThrow();
    expect(await snapshotDirs()).toEqual(before);
  });

  it('dispose 는 사본을 지운다', async () => {
    const tarball = buildTarball({
      entries: [
        { path: `${TOP}/`, type: '5' },
        { path: `${TOP}/a.txt`, body: 'x' },
      ],
    });
    const snapshot = await extractRepoSnapshot({ tarball });

    await snapshot.dispose();

    expect(existsSync(snapshot.root)).toBe(false);
  });
});
