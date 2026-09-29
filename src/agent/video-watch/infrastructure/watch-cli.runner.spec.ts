import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigService } from '@nestjs/config';

import { VideoWatchErrorCode } from '../domain/video-watch-error-code.enum';
import { WatchCliRunner } from './watch-cli.runner';

// 실제 python3 자식을 띄운다 — 실패 경로에서 "프로세스가 끝난 뒤에 거부하는가" 는 mock 으로 증명할 수 없다.
const OVERFLOW_SCRIPT = `
import os, sys, time
out_dir = sys.argv[sys.argv.index('--out-dir') + 1]
open(os.path.join(out_dir, 'pid'), 'w').write(str(os.getpid()))
sys.stdout.write('x' * (3 * 1024 * 1024))
sys.stdout.flush()
time.sleep(60)
`;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('WatchCliRunner', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'watch-runner-spec-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  // 거부 직후 호출자가 임시 폴더를 지우므로, 자식이 아직 살아 있으면 삭제와 경합한다.
  it('rejects an oversized report only after the child has exited', async () => {
    const scriptPath = join(workDir, 'overflow.py');
    await writeFile(scriptPath, OVERFLOW_SCRIPT);
    const runner = new WatchCliRunner({
      getOrThrow: () => scriptPath,
    } as unknown as ConfigService);

    // 거부된 바로 그 틱에서 동기로 확인한다 — await 를 한 번이라도 끼우면 그 사이 자식이 정리돼 경합이 가려진다.
    const aliveAtRejection = await runner
      .run({
        url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        outDir: workDir,
        homeDir: workDir,
      })
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (error: { errorCode?: string }) => {
          expect(error.errorCode).toBe(VideoWatchErrorCode.WATCH_FAILED);
          return isAlive(Number(readFileSync(join(workDir, 'pid'), 'utf-8')));
        },
      );

    expect(aliveAtRejection).toBe(false);
  }, 20_000);
});
