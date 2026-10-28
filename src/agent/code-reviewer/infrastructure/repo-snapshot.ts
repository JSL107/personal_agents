import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 리뷰 모델에게 읽기 전용으로 열어 줄 PR 시점 레포 사본.
export interface RepoSnapshot {
  root: string;
  dispose(): Promise<void>;
}

/**
 * GitHub tarball 을 `os.tmpdir()` 아래 새 디렉터리에 푼다. 모델이 읽으려면 호출자가 이 경로를
 * `readableRoots` 로 넘겨야 한다 — codex 권한 프로필은 허용한 경로만 연다.
 * 해제는 샌드박스 밖(이대리 프로세스)에서 일어나므로 사본 밖을 가리키는 항목(`..`·절대경로)은
 * bsdtar 기본 거부에 기대고, 실패하면 만든 디렉터리를 지운 뒤 던진다.
 */
export const extractRepoSnapshot = async (
  tarball: Buffer,
): Promise<RepoSnapshot> => {
  const root = await mkdtemp(join(tmpdir(), 'idaeri-review-repo-'));
  const dispose = (): Promise<void> =>
    rm(root, { recursive: true, force: true });
  try {
    await untar(tarball, root);
  } catch (error: unknown) {
    await dispose();
    throw error;
  }
  return { root, dispose };
};

const untar = (tarball: Buffer, root: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      'tar',
      ['-xzf', '-', '--strip-components', '1', '--no-same-owner', '-C', root],
      { stdio: ['pipe', 'ignore', 'pipe'] },
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
    child.stdin.end(tarball);
  });
