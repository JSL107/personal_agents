export const SANDBOX_RUNNER_PORT = Symbol('SANDBOX_RUNNER_PORT');

// 호스트 fs 를 거치지 않고 컨테이너 tmpfs 안에만 주입되는 파일.
// BE-Test self-correction 의 LLM 생성 spec, BE-1 의 stack trace 재현 spec,
// BE-4 의 fix patch 등 "호스트 변조 위험을 피해야 하는" 흐름이 공통 사용.
// containerPath 는 반드시 TMPFS 루트(/work/) 하위. consumer 는 임의 호스트 경로 지정 불가.
export interface TmpfsFile {
  containerPath: string;
  content: string;
}

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
  // tmpfs (/work) 에 in-memory 로 주입할 파일. 호스트 fs write 없음.
  // 제공되면 docker run 에 `--tmpfs /work:size=<tmpfsSize>,exec` 추가됨.
  tmpfsFiles?: TmpfsFile[];
  // tmpfs 크기. default '16m'. spec 1개당 보통 < 100KB 라 충분.
  tmpfsSize?: string;
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
