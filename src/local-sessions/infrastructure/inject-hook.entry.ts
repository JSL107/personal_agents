import { readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ConsumeDeps } from '../domain/inject-queue';
import { consumeInject } from '../domain/inject-queue';
import { buildStopDecision } from '../domain/stop-decision';

// Stop 훅 payload 를 fd 0 에서 블로킹으로 읽는다. codex/claude 가 payload 를 써주고 stdin 을
// close 하므로 EOF 까지 읽힌다. 수동 실행(TTY)은 EOF 가 없어 즉시 포기(훅 timeout 이 백스톱).
function readStopHookStdin(): string | null {
  if (process.stdin.isTTY) {
    return null;
  }
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function realConsumeDeps(): ConsumeDeps {
  return {
    injectDir: join(homedir(), '.idaeri', 'inject'),
    readdir: (dir) => readdirSync(dir),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    removeFile: (path) => {
      unlinkSync(path);
    },
    rmdir: (dir) => {
      rmdirSync(dir);
    },
  };
}

// 절대 throw 하지 않는다 — 우리 훅 오류로 세션을 멈추지 않기 위해 전 구간 방어.
function main(): void {
  try {
    const deps = realConsumeDeps();
    const consume = (pid: number, sessionId: string): string | null =>
      consumeInject(pid, sessionId, deps);
    const decision = buildStopDecision(
      readStopHookStdin(),
      process.ppid,
      consume,
    );
    if (decision.length > 0) {
      process.stdout.write(decision);
    }
  } catch {
    // 어떤 오류든 무시(정상 종료 허용).
  }
}

if (require.main === module) {
  main();
}
