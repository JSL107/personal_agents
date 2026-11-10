import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import { formatKstIsoDateTime } from '../../common/util/kst-date.util';
import {
  buildSafeChildEnv,
  getRealHomeDir,
  killProcessTree,
} from '../../model-router/infrastructure/cli-process.util';
import {
  AiWeeklyError,
  AiWeeklyErrorCode,
  isAiWeeklyErrorCode,
} from '../domain/ai-weekly-error';
import { AiWeeklyPeriod } from '../domain/ai-weekly-period';

const TIMEOUT_MS = 120_000;
const STDOUT_LIMIT = 1_048_576;
const STDERR_LIMIT = 4_096;

interface ScriptProcessInput {
  cwd: string;
  argumentsList: string[];
  environment: NodeJS.ProcessEnv;
}

interface ScriptExit {
  exitCode: number | null;
  failure: AiWeeklyErrorCode | null;
  stdout: string;
  stderr: string;
}

@Injectable()
export class AiWeeklyMetricsRunner {
  async run(period: AiWeeklyPeriod): Promise<unknown> {
    const cwd = process.cwd();
    const scriptPath = join(cwd, 'scripts', 'ai-weekly-metrics.py');
    if (!existsSync(scriptPath)) {
      throw new AiWeeklyError({
        code: AiWeeklyErrorCode.SCRIPT_MISSING,
        exitCode: null,
      });
    }
    const argumentsList = [
      '-I',
      '-B',
      scriptPath,
      '--since',
      formatKstIsoDateTime(period.since),
      '--until',
      formatKstIsoDateTime(period.until),
    ];
    const environment = buildSafeChildEnv({ cwd, homeDir: getRealHomeDir() });
    const scriptExit = await runScript({ cwd, argumentsList, environment });
    return readOutput(scriptExit);
  }
}

// 출력은 한도까지만 모으고, 한도 초과·시간 초과는 프로세스 트리를 끊고 사유만 남긴다.
const runScript = ({
  cwd,
  argumentsList,
  environment,
}: ScriptProcessInput): Promise<ScriptExit> =>
  new Promise<ScriptExit>((resolve, reject) => {
    const child = spawnScript({ cwd, argumentsList, environment });
    if (!child) {
      reject(spawnFailed());
      return;
    }
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    // 아래 이벤트 콜백들이 함께 갱신하는 상태라 const 로 둘 수 없다.
    let stdoutSize = 0;
    let stderrSize = 0;
    let failure: AiWeeklyErrorCode | null = null;
    const stop = (code: AiWeeklyErrorCode): void => {
      failure = code;
      killProcessTree(child.pid);
    };
    const timeout = setTimeout(
      () => stop(AiWeeklyErrorCode.TIMEOUT),
      TIMEOUT_MS,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > STDOUT_LIMIT) {
        stop(AiWeeklyErrorCode.OUTPUT_TOO_LARGE);
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const kept = chunk.subarray(0, STDERR_LIMIT - stderrSize);
      stderrChunks.push(kept);
      stderrSize += kept.length;
    });
    // error 뒤에 close 가 와도 이미 확정된 Promise 라 두 번째 reject 는 무시된다.
    child.on('error', () => {
      clearTimeout(timeout);
      reject(spawnFailed());
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        failure,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });

// spawn 은 인자가 잘못되면 이벤트 대신 동기로 던진다.
const spawnScript = ({
  cwd,
  argumentsList,
  environment,
}: ScriptProcessInput): ChildProcess | null => {
  try {
    return spawn('python3', argumentsList, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
  } catch {
    return null;
  }
};

const readOutput = ({
  exitCode,
  failure,
  stdout,
  stderr,
}: ScriptExit): unknown => {
  if (failure) {
    throw new AiWeeklyError({ code: failure, exitCode });
  }
  if (exitCode !== 0) {
    throw new AiWeeklyError({ code: readErrorCode(stderr), exitCode });
  }
  try {
    const parsed: unknown = JSON.parse(stdout);
    return parsed;
  } catch {
    throw new AiWeeklyError({ code: AiWeeklyErrorCode.BAD_JSON, exitCode });
  }
};

const readErrorCode = (stderr: string): AiWeeklyErrorCode => {
  const firstLine = stderr.split(/\r?\n/, 1)[0];
  const code = /^AIWM_ERROR ([A-Z_]+)$/.exec(firstLine)?.[1];
  if (code && isAiWeeklyErrorCode(code)) {
    return code;
  }
  return AiWeeklyErrorCode.UNKNOWN;
};

const spawnFailed = (): AiWeeklyError =>
  new AiWeeklyError({ code: AiWeeklyErrorCode.SPAWN_FAILED, exitCode: null });
