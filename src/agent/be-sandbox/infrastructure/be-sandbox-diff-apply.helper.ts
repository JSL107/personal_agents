import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPLY_TIMEOUT_MS = 30_000;

// host 작업 트리 변경 없이 diff 를 임시 디렉토리 위에 적용한 뒤 변경된 file content 를 읽는다.
// Phase 2b-2 의 PR open 흐름에서 사용 — 사용자 GITHUB_TOKEN 으로 push 하려면 새 file content 가 필요.
//
// 흐름:
//   1) mkdtemp(/tmp, 'idaeri-be-pr-') → tmpdir
//   2) `git clone --no-local --depth=1 file://<hostRepoPath> <tmpdir>` (hardlink 회피하여 안전 격리)
//   3) `git -C <tmpdir> apply -` (stdin 에 diff 전달)
//   4) 각 changedFile 의 새 content readFile
//   5) tmpdir cleanup
//
// host repo 자체는 절대 변경 X — clone 결과물만 수정.
export const applyDiffAndReadFiles = async ({
  hostRepoPath,
  diff,
  changedFiles,
}: {
  hostRepoPath: string;
  diff: string;
  changedFiles: string[];
}): Promise<Map<string, string>> => {
  const tmpDir = await mkdtemp(join(tmpdir(), 'idaeri-be-pr-'));
  try {
    await runSpawn(
      'git',
      ['clone', '--no-local', '--depth=1', `file://${hostRepoPath}`, tmpDir],
      { timeoutMs: APPLY_TIMEOUT_MS },
    );
    await runSpawn('git', ['-C', tmpDir, 'apply', '-'], {
      timeoutMs: APPLY_TIMEOUT_MS,
      stdinPayload: diff,
    });

    const contents = new Map<string, string>();
    for (const path of changedFiles) {
      const filePath = join(tmpDir, path);
      const content = await readFile(filePath, 'utf8');
      contents.set(path, content);
    }
    return contents;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
};

const runSpawn = (
  command: string,
  args: string[],
  options: { timeoutMs: number; stdinPayload?: string },
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [
        options.stdinPayload !== undefined ? 'pipe' : 'ignore',
        'pipe',
        'pipe',
      ],
    });

    let stderrTail = '';
    const stderrCap = 4_000;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} 응답 시간 초과 (${options.timeoutMs}ms)`));
    }, options.timeoutMs);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-stderrCap);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} exit=${code} stderr=${stderrTail.slice(-500)}`,
        ),
      );
    });

    if (options.stdinPayload !== undefined) {
      child.stdin?.write(options.stdinPayload);
      child.stdin?.end();
    }
  });
