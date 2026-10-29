import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { buildSafeChildEnv } from '../../../model-router/infrastructure/cli-process.util';
import { RepoSnapshot } from '../domain/code-reviewer.type';
import { isSecretFilePath } from '../domain/secret-file';
import {
  findUnsafeTarEntries,
  listTarEntryNames,
  toSnapshotRelativePath,
} from '../domain/tar-entry-guard';

// 압축을 푼 tar 의 상한. 압축 상한만으로는 고압축 파일 하나가 임시 디스크를 채울 수 있다.
// 이대리 레포는 풀면 232MB 다(2026-10-28 실측).
// ponytail: 압축 해제를 메모리에서 한 번에 한다(최대 약 0.8GB). 스윕은 회차가 겹치지 않아 사본이 한 번에
// 하나만 열리고, 압축 256MB 안으로 실측한 레포만 스위치에 넣는다는 전제다. 그보다 큰 레포를 켜거나
// 사본을 쓰는 경로가 스윕 밖으로 늘어 동시에 여럿 열리게 되면 스트리밍 해제로 바꾼다.
export const REPO_SNAPSHOT_MAX_EXTRACTED_BYTES = 536_870_912;

// 사본 디렉터리 접두사. 뒤에 만든 프로세스의 PID 를 붙여, 죽은 프로세스가 남긴 사본만 골라 지운다.
export const REPO_SNAPSHOT_DIR_PREFIX = 'idaeri-review-repo-';

/**
 * GitHub tarball 을 `os.tmpdir()` 아래 새 디렉터리에 푼다. 모델이 읽으려면 호출자가 이 경로를
 * `readableRoots` 로 넘겨야 한다 — codex 권한 프로필은 허용한 경로만 연다.
 * 해제는 샌드박스 밖(이대리 프로세스)에서 일어나므로 사본 밖을 가리키는 항목(`..`·절대경로·
 * 사본 밖으로 향하는 링크)은 풀기 전에 findUnsafeTarEntries 로 거르고, 해제가 실패하면 만든
 * 디렉터리를 지운 뒤 던진다.
 */
export const extractRepoSnapshot = async ({
  tarball,
  maxExtractedBytes = REPO_SNAPSHOT_MAX_EXTRACTED_BYTES,
}: {
  tarball: Buffer;
  // 테스트가 작은 값으로 상한 동작을 확인하려고 연다. 운영 호출은 넘기지 않는다.
  maxExtractedBytes?: number;
}): Promise<RepoSnapshot> => {
  // 상한을 넘으면 RangeError 로 끊긴다 — 디렉터리를 만들기 전에 거른다.
  const tar = await promisify(gunzip)(tarball, {
    maxOutputLength: maxExtractedBytes,
  });
  // 시스템 tar 의 거부 동작은 구현마다 다르다 — 사본 밖을 가리키는 항목은 풀기 전에 거른다.
  const unsafe = findUnsafeTarEntries({ tar });
  if (unsafe.length > 0) {
    throw new Error(`tarball 거부 — ${unsafe.slice(0, 3).join(' / ')}`);
  }
  const excludes = listTarEntryNames({ tar }).filter((name) =>
    isSecretFilePath(toSnapshotRelativePath(name)),
  );
  const root = await mkdtemp(
    join(tmpdir(), `${REPO_SNAPSHOT_DIR_PREFIX}${process.pid}-`),
  );
  const dispose = (): Promise<void> =>
    rm(root, { recursive: true, force: true });
  try {
    await untar({ tar, root, excludes });
  } catch (error: unknown) {
    await dispose();
    throw error;
  }
  return { root, dispose };
};

// bsdtar 의 --exclude 는 글롭 패턴이다 — 이름에 든 글롭 문자를 이스케이프해 그 항목만 정확히 뺀다.
const escapeTarPattern = (name: string): string =>
  name.replace(/[\\*?[]/g, (character) => `\\${character}`);

const untar = ({
  tar,
  root,
  excludes,
}: {
  tar: Buffer;
  root: string;
  // 아카이브에 적힌 그대로의 항목 경로. --strip-components 이전 이름과 맞춰야 걸린다.
  excludes: string[];
}): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'tar',
      [
        '-xf',
        '-',
        '--strip-components',
        '1',
        '--no-same-owner',
        '-C',
        root,
        ...excludes.flatMap((name) => ['--exclude', escapeTarPattern(name)]),
      ],
      {
        // 앱 env(DATABASE_URL·토큰)를 넘기지 않는다 — CLI 자식 프로세스와 같은 allowlist.
        env: buildSafeChildEnv({ cwd: root }),
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`tarball 해제 실패 (exit=${code}): ${stderr.trim()}`));
    });
    child.stdin.on('error', reject);
    child.stdin.end(tar);
  });

// 기본 생존 판정. 신호 0 은 보내지 않고 존재만 묻는다 — 권한이 없어도(EPERM) 프로세스는 살아 있다.
const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * 죽은 프로세스가 남긴 사본을 지운다. 리뷰 도중 프로세스가 죽으면 dispose 가 돌지 않아 회사 코드가
 * 임시 폴더에 남는다. 같은 임시 폴더를 쓰는 다른 프로세스(재생 CLI·worktree 백엔드)의 진행 중 사본을
 * 지우지 않도록 나이가 아니라 만든 프로세스의 생존으로 가른다. PID 가 없는 옛 형식(1단계 재생)은
 * 주인을 알 수 없어 건드리지 않는다 — 진행 중일 수 있고, 남아도 OS 가 임시 폴더를 주기적으로 비운다.
 * 지운 경로를 돌려준다.
 */
export const removeOrphanRepoSnapshots = async ({
  tmpRoot = tmpdir(),
  isAlive = isProcessAlive,
}: {
  tmpRoot?: string;
  isAlive?: (pid: number) => boolean;
} = {}): Promise<string[]> => {
  const names = await readdir(tmpRoot);
  const orphans = names
    .filter((name) => name.startsWith(REPO_SNAPSHOT_DIR_PREFIX))
    .filter((name) => {
      const match = /^(\d+)-/.exec(name.slice(REPO_SNAPSHOT_DIR_PREFIX.length));
      return match !== null && !isAlive(Number(match[1]));
    })
    .map((name) => join(tmpRoot, name));
  await Promise.all(
    orphans.map((path) => rm(path, { recursive: true, force: true })),
  );
  return orphans;
};
