import { spawn } from 'node:child_process';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  buildSafeChildEnv,
  killProcessTree,
} from '../../../model-router/infrastructure/cli-process.util';
import {
  WatchRunnerInput,
  WatchRunnerPort,
} from '../domain/port/watch-runner.port';
import { WATCH_MAX_FRAMES } from '../domain/video-watch.constants';
import { VideoWatchException } from '../domain/video-watch.exception';
import { VideoWatchErrorCode } from '../domain/video-watch-error-code.enum';

export const WATCH_TIMEOUT_MS = 300_000;
const STDOUT_LIMIT = 2 * 1024 * 1024;
const STDERR_TAIL_LIMIT = 1000;

@Injectable()
export class WatchCliRunner implements WatchRunnerPort {
  private readonly logger = new Logger(WatchCliRunner.name);

  constructor(private readonly configService: ConfigService) {}

  run({ url, outDir, homeDir }: WatchRunnerInput): Promise<string> {
    const scriptPath =
      this.configService.getOrThrow<string>('WATCH_SCRIPT_PATH');
    return new Promise((resolve, reject) => {
      const child = spawn(
        'python3',
        [
          scriptPath,
          url,
          '--engine',
          'local',
          '--detail',
          'balanced',
          '--max-frames',
          String(WATCH_MAX_FRAMES),
          '--resolution',
          '512',
          '--no-whisper',
          '--out-dir',
          outDir,
        ],
        {
          cwd: outDir,
          env: buildSafeChildEnv({
            cwd: outDir,
            homeDir,
            additionalEnv: { WATCH_ENGINE: 'local' },
          }),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        },
      );

      let stdout = '';
      let stderrTail = '';
      let settled = false;
      const fail = (exception: VideoWatchException): void => {
        if (!settled) {
          settled = true;
          reject(exception);
        }
      };
      const timer = setTimeout(() => {
        killProcessTree(child.pid);
        fail(
          new VideoWatchException({
            code: VideoWatchErrorCode.WATCH_TIMEOUT,
            message:
              '영상 분석 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
            status: DomainStatus.INTERNAL,
          }),
        );
      }, WATCH_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled) {
          return;
        }
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout, 'utf8') > STDOUT_LIMIT) {
          killProcessTree(child.pid);
          fail(
            new VideoWatchException({
              code: VideoWatchErrorCode.WATCH_FAILED,
              message: '영상 분석 결과가 허용 크기를 초과했습니다.',
            }),
          );
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
      });
      child.on('error', (error: Error) => {
        clearTimeout(timer);
        fail(
          new VideoWatchException({
            code: VideoWatchErrorCode.WATCH_FAILED,
            message: '영상 분석 도구를 실행하지 못했습니다.',
            cause: error,
          }),
        );
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (settled) {
          return;
        }
        if (code === 0) {
          settled = true;
          resolve(stdout);
          return;
        }
        this.logger.error(
          `watch.py exit=${code} stderrTail=${stderrTail.slice(-STDERR_TAIL_LIMIT)}`,
        );
        fail(
          new VideoWatchException({
            code: VideoWatchErrorCode.WATCH_FAILED,
            message: '영상 분석에 실패했습니다. 잠시 후 다시 시도해주세요.',
          }),
        );
      });
    });
  }
}
