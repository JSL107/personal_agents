import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import {
  buildSafeChildEnv,
  getRealHomeDir,
  killProcessTree,
} from '../../model-router/infrastructure/cli-process.util';
import {
  AI_WEEKLY_ERROR_CODES,
  AiWeeklyError,
  AiWeeklyErrorCode,
} from '../domain/ai-weekly-error';
import { AiWeeklyPeriod, toKstIso } from '../domain/ai-weekly-period';

const TIMEOUT_MS = 120_000;
const STDOUT_LIMIT = 1_048_576;
const STDERR_LIMIT = 4_096;

@Injectable()
export class AiWeeklyMetricsRunner {
  async run(period: AiWeeklyPeriod): Promise<unknown> {
    const cwd = process.cwd();
    const scriptPath = join(cwd, 'scripts', 'ai-weekly-metrics.py');
    if (!existsSync(scriptPath)) {
      throw new AiWeeklyError({ code: 'SCRIPT_MISSING', exitCode: null });
    }
    const argumentsList = [
      '-I',
      '-B',
      scriptPath,
      '--since',
      toKstIso(period.since),
      '--until',
      toKstIso(period.until),
    ];
    const environment = buildSafeChildEnv({ cwd, homeDir: getRealHomeDir() });
    return await new Promise<unknown>((resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let outputSize = 0;
      let stderrSize = 0;
      let failure: AiWeeklyErrorCode | null = null;
      let settled = false;
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('python3', argumentsList, {
          cwd,
          env: environment,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });
      } catch {
        reject(new AiWeeklyError({ code: 'SPAWN_FAILED', exitCode: null }));
        return;
      }
      const timeout = setTimeout(() => {
        failure = 'TIMEOUT';
        killProcessTree(child.pid);
      }, TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => {
        outputSize += chunk.length;
        if (outputSize > STDOUT_LIMIT) {
          failure = 'OUTPUT_TOO_LARGE';
          killProcessTree(child.pid);
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrSize < STDERR_LIMIT) {
          const remainder = STDERR_LIMIT - stderrSize;
          const kept = chunk.subarray(0, remainder);
          stderrChunks.push(kept);
          stderrSize += kept.length;
        }
      });
      child.on('error', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(new AiWeeklyError({ code: 'SPAWN_FAILED', exitCode: null }));
      });
      child.on('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (failure) {
          reject(new AiWeeklyError({ code: failure, exitCode }));
          return;
        }
        if (exitCode !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          reject(
            new AiWeeklyError({ code: this.readErrorCode(stderr), exitCode }),
          );
          return;
        }
        try {
          const stdout = Buffer.concat(stdoutChunks).toString('utf8');
          const parsed: unknown = JSON.parse(stdout);
          resolve(parsed);
        } catch {
          reject(new AiWeeklyError({ code: 'BAD_JSON', exitCode }));
        }
      });
    });
  }

  private readErrorCode(stderr: string): AiWeeklyErrorCode {
    const firstLine = stderr.split(/\r?\n/, 1)[0];
    const match = /^AIWM_ERROR ([A-Z_]+)$/.exec(firstLine);
    if (
      match &&
      AI_WEEKLY_ERROR_CODES.includes(match[1] as AiWeeklyErrorCode)
    ) {
      return match[1] as AiWeeklyErrorCode;
    }
    return 'UNKNOWN';
  }
}
