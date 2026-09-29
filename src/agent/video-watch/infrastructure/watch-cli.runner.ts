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
// SIGKILL 뒤 close 가 끝내 안 올 때(좀비 회수 지연 등)만 쓰는 안전 상한.
const KILL_GRACE_MS = 5_000;

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
      let pendingFailure: VideoWatchException | null = null;
      const fail = (exception: VideoWatchException): void => {
        if (!settled) {
          settled = true;
          reject(exception);
        }
      };
      // 죽이고 바로 거부하면 호출자의 finally 가 임시 폴더를 지우는 동안 자식이 아직 살아 있다
      // (SIGKILL 전달은 비동기 — spec 으로 재현). 그래서 close 를 받은 뒤에 거부한다.
      const abort = (exception: VideoWatchException): void => {
        if (settled || pendingFailure) {
          return;
        }
        pendingFailure = exception;
        killProcessTree(child.pid);
        setTimeout(() => fail(exception), KILL_GRACE_MS).unref();
      };
      const timer = setTimeout(() => {
        abort(
          new VideoWatchException({
            code: VideoWatchErrorCode.WATCH_TIMEOUT,
            message:
              '영상 분석 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
            status: DomainStatus.INTERNAL,
          }),
        );
      }, WATCH_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        if (settled || pendingFailure) {
          return;
        }
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout, 'utf8') > STDOUT_LIMIT) {
          abort(
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
        if (pendingFailure) {
          fail(pendingFailure);
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
