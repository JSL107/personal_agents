import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  SandboxRunnerPort,
  SandboxRunRequest,
  SandboxRunResult,
} from '../domain/port/sandbox-runner.port';
import { SandboxException } from '../domain/sandbox.exception';
import { SandboxErrorCode } from '../domain/sandbox-error-code.enum';

const DEFAULT_IMAGE = 'node:20-alpine';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_NETWORK_MODE = 'none';
// DoS 방지: stdout/stderr 각각 256KB 초과분은 버린다.
const OUTPUT_CAP_BYTES = 256_000;

// 셸 인젝션을 유발할 수 있는 메타문자 목록.
// mount path 는 args 배열로 전달되므로 실제 escape 는 필요 없지만,
// 의도치 않은 경로(ex. 심볼릭 링크 우회 시도)를 사전 차단한다.
const UNSAFE_PATH_CHARS = /[;&|<>$`'"\\]/;

@Injectable()
export class DockerSandboxRunner implements SandboxRunnerPort {
  private readonly logger = new Logger(DockerSandboxRunner.name);

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    this.validateMountPath(req.hostMountPath);

    const args = this.buildDockerArgs(req);
    const startTime = Date.now();

    return new Promise<SandboxRunResult>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;

      try {
        // shell: false (기본값) — args 배열 직접 전달로 셸 인젝션 차단.
        child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        reject(
          new SandboxException({
            message: 'docker spawn failed',
            code: SandboxErrorCode.DOCKER_SPAWN_FAILED,
            status: DomainStatus.INTERNAL,
            cause: err,
          }),
        );
        return;
      }

      let stdoutBuf = Buffer.alloc(0);
      let stderrBuf = Buffer.alloc(0);
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        // 컨테이너가 살아있는 경우 강제 종료.
        child.kill('SIGKILL');
      }, req.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        const remaining = OUTPUT_CAP_BYTES - stdoutBuf.length;
        if (remaining <= 0) {
          stdoutTruncated = true;
          return;
        }
        if (chunk.length > remaining) {
          stdoutBuf = Buffer.concat([stdoutBuf, chunk.subarray(0, remaining)]);
          stdoutTruncated = true;
        } else {
          stdoutBuf = Buffer.concat([stdoutBuf, chunk]);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const remaining = OUTPUT_CAP_BYTES - stderrBuf.length;
        if (remaining <= 0) {
          stderrTruncated = true;
          return;
        }
        if (chunk.length > remaining) {
          stderrBuf = Buffer.concat([stderrBuf, chunk.subarray(0, remaining)]);
          stderrTruncated = true;
        } else {
          stderrBuf = Buffer.concat([stderrBuf, chunk]);
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        reject(
          new SandboxException({
            message: `docker process error: ${err.message}`,
            code: SandboxErrorCode.DOCKER_SPAWN_FAILED,
            status: DomainStatus.INTERNAL,
            cause: err,
          }),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        const durationMs = Date.now() - startTime;

        this.logger.log(
          `sandbox finished exitCode=${code ?? -1} durationMs=${durationMs} timedOut=${timedOut}`,
        );

        resolve({
          exitCode: code ?? -1,
          stdout: stdoutBuf.toString('utf8'),
          stderr: stderrBuf.toString('utf8'),
          durationMs,
          timedOut,
          stdoutTruncated,
          stderrTruncated,
        });
      });
    });
  }

  private validateMountPath(hostMountPath: string): void {
    if (!hostMountPath.startsWith('/')) {
      throw new SandboxException({
        message: `mount path must be absolute: ${hostMountPath}`,
        code: SandboxErrorCode.UNSAFE_MOUNT_PATH,
        status: DomainStatus.BAD_REQUEST,
      });
    }
    if (UNSAFE_PATH_CHARS.test(hostMountPath)) {
      throw new SandboxException({
        message: `mount path contains unsafe characters: ${hostMountPath}`,
        code: SandboxErrorCode.UNSAFE_MOUNT_PATH,
        status: DomainStatus.BAD_REQUEST,
      });
    }
  }

  private buildDockerArgs(req: SandboxRunRequest): string[] {
    const {
      command,
      hostMountPath,
      mountMode = 'ro',
      image = DEFAULT_IMAGE,
      networkMode = DEFAULT_NETWORK_MODE,
      env = {},
      readOnlyMounts = [],
    } = req;

    const args: string[] = ['run', '--rm', '--network', networkMode];

    // 주 작업 디렉터리 마운트. default 'ro' — consumer 가 명시 'rw' 한 경우만 변조 허용 (audit codex P1).
    args.push('-v', `${hostMountPath}:/repo:${mountMode}`);
    args.push('-w', '/repo');

    // 환경변수 주입.
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    // read-only 추가 마운트 (예: pnpm store cache).
    for (const { hostPath, containerPath } of readOnlyMounts) {
      args.push('-v', `${hostPath}:${containerPath}:ro`);
    }

    args.push(image, '/bin/sh', '-c', command);

    return args;
  }
}
