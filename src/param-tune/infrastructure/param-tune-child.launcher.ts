import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

export type ChildOutcome =
  | { kind: 'EXITED'; code: number; tail: string }
  | { kind: 'TIMEOUT'; tail: string }
  | { kind: 'SPAWN_FAILED'; message: string };

export interface ParamTuneChildRunInput {
  args: string[];
  // 상대 경로는 레포 루트 기준이다 — 호출자가 cwd 에 기대지 않게 한다.
  logPath: string;
  timeoutMs: number;
}

const ENTRY_SCRIPT = join('scripts', 'parameter-tune.ts');
const MAX_LEVELS_UP = 6;
const KILL_GRACE_MS = 10_000;
const TAIL_LINES = 20;

/**
 * 컴파일본은 `dist/src/...`, ts-node·jest 는 `src/...` 에서 돌아 `__dirname` 깊이가 다르다.
 * 깊이를 박지 않고 위로 걸어 올라가 진입 스크립트가 있는 첫 디렉터리를 레포 루트로 본다.
 */
export const findRepoRoot = (
  startDir: string,
  exists: (path: string) => boolean,
): string | null => {
  let current = startDir;
  for (let level = 0; level <= MAX_LEVELS_UP; level += 1) {
    if (
      exists(join(current, 'package.json')) &&
      exists(join(current, ENTRY_SCRIPT))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
};

const logger = new Logger('ParamTuneChildLauncher');

const readTail = (logPath: string): string => {
  try {
    const lines = readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    return lines.slice(-TAIL_LINES).join('\n');
  } catch (error) {
    // 로그가 아직 없거나 못 읽으면 꼬리 없이 실패 사유만 남긴다.
    logger.warn(`자식 로그 꼬리를 읽지 못했다 (${logPath}): ${String(error)}`);
    return '';
  }
};

@Injectable()
export class ParamTuneChildLauncher {
  async run(input: ParamTuneChildRunInput): Promise<ChildOutcome> {
    const root = findRepoRoot(__dirname, existsSync);
    if (root === null) {
      return {
        kind: 'SPAWN_FAILED',
        message: `레포 루트를 찾지 못했습니다 (${ENTRY_SCRIPT} 없음, 시작 ${__dirname}).`,
      };
    }

    const logPath = resolvePath(root, input.logPath);
    let fd: number;
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      fd = openSync(logPath, 'a');
    } catch (error) {
      return {
        kind: 'SPAWN_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return new Promise<ChildOutcome>((resolve) => {
      let settled = false;
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;

      const finish = (build: () => ChildOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(killTimer);
        closeSync(fd);
        resolve(build());
      };

      const child = spawn(
        process.execPath,
        ['-r', 'ts-node/register/transpile-only', ENTRY_SCRIPT, ...input.args],
        { cwd: root, stdio: ['ignore', fd, fd] },
      );

      child.on('error', (error) =>
        finish(() => ({ kind: 'SPAWN_FAILED', message: error.message })),
      );
      child.on('exit', (code) =>
        finish(() =>
          timedOut
            ? { kind: 'TIMEOUT', tail: readTail(logPath) }
            : {
                kind: 'EXITED',
                code: code ?? -1,
                tail: readTail(logPath),
              },
        ),
      );

      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, KILL_GRACE_MS);
      }, input.timeoutMs);
    });
  }
}
