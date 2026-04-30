export const SANDBOX_RUNNER_PORT = Symbol('SANDBOX_RUNNER_PORT');

export interface SandboxRunRequest {
  // 컨테이너 안 /bin/sh -c 로 실행될 셸 명령. 예: 'pnpm test src/foo/foo.spec.ts'.
  command: string;
  // 호스트의 절대경로. 컨테이너 /repo 로 마운트.
  hostMountPath: string;
  // default 'ro' — 호스트 fs 변조 방지 (audit codex P1). 'rw' 는 명시적으로 필요한 경우에만
  // (예: pnpm install, fix patch 적용). consumer 가 명시하지 않으면 read-only.
  mountMode?: 'ro' | 'rw';
  // default 'node:20-alpine'
  image?: string;
  // default 60_000ms. 초과 시 SIGKILL → timedOut: true.
  timeoutMs?: number;
  // default 'none' (망 분리). 'bridge' 가능 — pnpm install 등에서.
  networkMode?: 'none' | 'bridge';
  // 환경변수.
  env?: Record<string, string>;
  // read-only mount (예: pnpm cache).
  readOnlyMounts?: { hostPath: string; containerPath: string }[];
}

export interface SandboxRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface SandboxRunnerPort {
  run(req: SandboxRunRequest): Promise<SandboxRunResult>;
}
