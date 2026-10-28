import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { buildSafeChildEnv } from '../../../model-router/infrastructure/cli-process.util';
import { RepoSnapshot } from '../domain/code-reviewer.type';
import { findUnsafeTarEntries } from '../domain/tar-entry-guard';

// 압축을 푼 tar 의 상한. 압축 상한만으로는 고압축 파일 하나가 임시 디스크를 채울 수 있다.
// 이대리 레포는 풀면 232MB 다(2026-10-28 실측).
// ponytail: 압축 해제를 메모리에서 한 번에 한다(최대 약 0.8GB) — 운영 경로에 붙일 때 스트리밍으로.
export const REPO_SNAPSHOT_MAX_EXTRACTED_BYTES = 536_870_912;

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
  const root = await mkdtemp(join(tmpdir(), 'idaeri-review-repo-'));
  const dispose = (): Promise<void> =>
    rm(root, { recursive: true, force: true });
  try {
    await untar({ tar, root });
  } catch (error: unknown) {
    await dispose();
    throw error;
  }
  return { root, dispose };
};

const untar = ({ tar, root }: { tar: Buffer; root: string }): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'tar',
      ['-xf', '-', '--strip-components', '1', '--no-same-owner', '-C', root],
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
