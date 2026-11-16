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

export interface RepoRootSearch {
  startDir: string;
  exists: (path: string) => boolean;
}

interface UpwardSearch {
  dir: string;
  exists: (path: string) => boolean;
  levelsLeft: number;
}

type OpenedLog = { kind: 'OPENED'; fd: number } | ChildOutcome;

interface ChildState {
  settled: boolean;
  timedOut: boolean;
  killTimer: NodeJS.Timeout | undefined;
}

const ENTRY_SCRIPT = join('scripts', 'parameter-tune.ts');
const MAX_LEVELS_UP = 6;
const KILL_GRACE_MS = 10_000;
const TAIL_LINES = 20;

/**
 * 컴파일본은 `dist/src/...`, ts-node·jest 는 `src/...` 에서 돌아 `__dirname` 깊이가 다르다.
 * 깊이를 박지 않고 위로 걸어 올라가 진입 스크립트가 있는 첫 디렉터리를 레포 루트로 본다.
 */
export const findRepoRoot = ({
  startDir,
  exists,
}: RepoRootSearch): string | null =>
  findUpward({ dir: startDir, exists, levelsLeft: MAX_LEVELS_UP });

const findUpward = ({
  dir,
  exists,
  levelsLeft,
}: UpwardSearch): string | null => {
  if (exists(join(dir, 'package.json')) && exists(join(dir, ENTRY_SCRIPT))) {
    return dir;
  }
  const parent = dirname(dir);
  if (parent === dir || levelsLeft === 0) {
    return null;
  }
  return findUpward({ dir: parent, exists, levelsLeft: levelsLeft - 1 });
};

const logger = new Logger('ParamTuneChildLauncher');

const readTail = (logPath: string): string => {
  try {
    const lines = readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const tail = lines.slice(-TAIL_LINES);
    return tail.join('\n');
  } catch (error) {
    // 로그가 아직 없거나 못 읽으면 꼬리 없이 실패 사유만 남긴다.
    logger.warn(`자식 로그 꼬리를 읽지 못했다 (${logPath}): ${String(error)}`);
    return '';
  }
};

const openLog = (logPath: string): OpenedLog => {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    return { kind: 'OPENED', fd: openSync(logPath, 'a') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'SPAWN_FAILED', message };
  }
};

@Injectable()
export class ParamTuneChildLauncher {
  async run(input: ParamTuneChildRunInput): Promise<ChildOutcome> {
    const root = findRepoRoot({ startDir: __dirname, exists: existsSync });
    if (root === null) {
      return {
        kind: 'SPAWN_FAILED',
        message: `레포 루트를 찾지 못했습니다 (${ENTRY_SCRIPT} 없음, 시작 ${__dirname}).`,
      };
    }

    const logPath = resolvePath(root, input.logPath);
    const opened = openLog(logPath);
    if (opened.kind !== 'OPENED') {
      return opened;
    }
    const { fd } = opened;

    return new Promise<ChildOutcome>((resolve) => {
      // 콜백들이 함께 고치는 상태라 한 객체에 둔다.
      const state: ChildState = {
        settled: false,
        timedOut: false,
        killTimer: undefined,
      };

      const finish = (build: () => ChildOutcome): void => {
        if (state.settled) {
          return;
        }
        state.settled = true;
        clearTimeout(timeoutTimer);
        clearTimeout(state.killTimer);
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
          state.timedOut
            ? { kind: 'TIMEOUT', tail: readTail(logPath) }
            : {
                kind: 'EXITED',
                code: code ?? -1,
                tail: readTail(logPath),
              },
        ),
      );

      const timeoutTimer = setTimeout(() => {
        state.timedOut = true;
        child.kill('SIGTERM');
        state.killTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, KILL_GRACE_MS);
      }, input.timeoutMs);
    });
  }
}
