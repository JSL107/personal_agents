import { EventEmitter } from 'events';
import { Readable } from 'stream';

import { SandboxException } from '../domain/sandbox.exception';
import { SandboxErrorCode } from '../domain/sandbox-error-code.enum';
import { DockerSandboxRunner } from './docker-sandbox-runner';

// child_process.spawn 을 전체 모킹 — 실제 docker 없이 동작 검증.
jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;

/** 가짜 child process 를 만들어 돌려주는 헬퍼. */
function makeChild(options: {
  exitCode?: number;
  stdoutChunks?: Buffer[];
  stderrChunks?: Buffer[];
  // true 면 close 이벤트를 즉시 emit, false 면 callerTimer 로 emit
  closeImmediately?: boolean;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable;
    stderr: Readable;
    kill: jest.Mock;
    killed: boolean;
  };

  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  child.stdout = stdout;
  child.stderr = stderr;
  child.killed = false;
  child.kill = jest.fn().mockImplementation(() => {
    child.killed = true;
    // SIGKILL 이후 close 이벤트 모사.
    setImmediate(() => child.emit('close', null));
  });

  // 다음 tick에 chunk + close 를 순서대로 emit.
  setImmediate(() => {
    for (const chunk of options.stdoutChunks ?? []) {
      stdout.emit('data', chunk);
    }
    for (const chunk of options.stderrChunks ?? []) {
      stderr.emit('data', chunk);
    }
    if (options.closeImmediately !== false) {
      child.emit('close', options.exitCode ?? 0);
    }
  });

  return child;
}

describe('DockerSandboxRunner', () => {
  let runner: DockerSandboxRunner;

  beforeEach(() => {
    runner = new DockerSandboxRunner();
    mockSpawn.mockReset();
  });

  it('happy path: exit 0 + stdout/stderr 캡처 + durationMs > 0', async () => {
    const child = makeChild({
      exitCode: 0,
      stdoutChunks: [Buffer.from('hello')],
      stderrChunks: [Buffer.from('warn')],
    });
    mockSpawn.mockReturnValue(child as any);

    const result = await runner.run({
      command: 'echo hello',
      hostMountPath: '/tmp/repo',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('warn');
    // mock 환경에서는 즉시 close 되어 0ms 가 가능 — 음수만 아니면 OK.
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdoutTruncated).toBe(false);
    expect(result.stderrTruncated).toBe(false);
  });

  it('exit code propagation: child exit 1 → result.exitCode === 1', async () => {
    const child = makeChild({ exitCode: 1 });
    mockSpawn.mockReturnValue(child as any);

    const result = await runner.run({
      command: 'exit 1',
      hostMountPath: '/tmp/repo',
    });

    expect(result.exitCode).toBe(1);
  });

  it('timeout: 짧은 timeout 으로 child 가 살아있을 때 SIGKILL 호출 + timedOut: true', async () => {
    // closeImmediately: false — close 이벤트는 kill() 내부에서만 emit.
    const child = makeChild({ closeImmediately: false });
    mockSpawn.mockReturnValue(child as any);

    const result = await runner.run({
      command: 'sleep 999',
      hostMountPath: '/tmp/repo',
      timeoutMs: 1, // 1ms — 거의 즉시 timeout
    });

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.timedOut).toBe(true);
  });

  it('shell metachar 포함 mount path: UNSAFE_MOUNT_PATH throw', async () => {
    await expect(
      runner.run({ command: 'echo', hostMountPath: '/tmp/repo;rm -rf /' }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.UNSAFE_MOUNT_PATH,
    });
  });

  it('절대경로 아닌 mount path: UNSAFE_MOUNT_PATH throw', async () => {
    await expect(
      runner.run({ command: 'echo', hostMountPath: 'relative/path' }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.UNSAFE_MOUNT_PATH,
    });
  });

  it('args 빌더: --network none default + image default node:20-alpine', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({ command: 'echo', hostMountPath: '/tmp/repo' });

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('docker');
    expect(args).toContain('--network');
    const networkIdx = (args as string[]).indexOf('--network');
    expect((args as string[])[networkIdx + 1]).toBe('none');
    expect(args).toContain('node:20-alpine');
  });

  it('args 빌더: readOnlyMounts 에 :ro suffix 포함', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({
      command: 'echo',
      hostMountPath: '/tmp/repo',
      readOnlyMounts: [
        { hostPath: '/pnpm-store', containerPath: '/root/.pnpm-store' },
      ],
    });

    const [, args] = mockSpawn.mock.calls[0];
    const vArgs = (args as string[]).filter((_, i, a) => a[i - 1] === '-v');
    const pnpmMount = vArgs.find((v) => v.startsWith('/pnpm-store:'));
    expect(pnpmMount).toBe('/pnpm-store:/root/.pnpm-store:ro');
  });

  it('args 빌더: mountMode default 는 :ro (audit codex P1 — 호스트 fs 변조 차단)', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({ command: 'echo', hostMountPath: '/tmp/repo' });

    const [, args] = mockSpawn.mock.calls[0];
    const vArgs = (args as string[]).filter((_, i, a) => a[i - 1] === '-v');
    expect(vArgs[0]).toBe('/tmp/repo:/repo:ro');
  });

  it("args 빌더: mountMode 'rw' 명시 시 :rw 적용", () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({
      command: 'echo',
      hostMountPath: '/tmp/repo',
      mountMode: 'rw',
    });

    const [, args] = mockSpawn.mock.calls[0];
    const vArgs = (args as string[]).filter((_, i, a) => a[i - 1] === '-v');
    expect(vArgs[0]).toBe('/tmp/repo:/repo:rw');
  });

  it('stdout cap: 256KB 초과 chunk → stdoutTruncated: true', async () => {
    const bigChunk = Buffer.alloc(300_000, 'x');
    const child = makeChild({ exitCode: 0, stdoutChunks: [bigChunk] });
    mockSpawn.mockReturnValue(child as any);

    const result = await runner.run({
      command: 'cat bigfile',
      hostMountPath: '/tmp/repo',
    });

    expect(result.stdoutTruncated).toBe(true);
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(256_000);
  });

  it('spawn 자체 에러 → SandboxException(DOCKER_SPAWN_FAILED)', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('docker not found');
    });

    await expect(
      runner.run({ command: 'echo', hostMountPath: '/tmp/repo' }),
    ).rejects.toBeInstanceOf(SandboxException);

    await expect(
      runner.run({ command: 'echo', hostMountPath: '/tmp/repo' }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.DOCKER_SPAWN_FAILED,
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // tmpfs file 주입 (BE-Test self-correction 재도입 plan 단계 1).
  // 호스트 fs write 없이 컨테이너 in-memory 에 spec/patch/stack-trace 주입.
  // ────────────────────────────────────────────────────────────────────────

  it('tmpfsFiles 미지정 / 빈 배열 → --tmpfs arg 없음 + command 변경 없음', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({
      command: 'echo hello',
      hostMountPath: '/tmp/repo',
      tmpfsFiles: [],
    });

    const [, args] = mockSpawn.mock.calls[0];
    expect((args as string[]).includes('--tmpfs')).toBe(false);
    // 명령은 그대로 마지막 인자로 전달.
    expect((args as string[])[(args as string[]).length - 1]).toBe(
      'echo hello',
    );
  });

  it('tmpfsFiles 1개 → --tmpfs /work:size=16m,exec + HEREDOC prelude + 원본 command', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    const specCode =
      "describe('x', () => { it('ok', () => expect(1).toBe(1)); });";
    runner.run({
      command: 'pnpm jest /work/generated.spec.ts --rootDir=/repo',
      hostMountPath: '/tmp/repo',
      tmpfsFiles: [
        { containerPath: '/work/generated.spec.ts', content: specCode },
      ],
    });

    const [, args] = mockSpawn.mock.calls[0];
    const tmpfsIdx = (args as string[]).indexOf('--tmpfs');
    expect(tmpfsIdx).toBeGreaterThan(-1);
    expect((args as string[])[tmpfsIdx + 1]).toBe('/work:size=16m,exec');

    const finalCommand = (args as string[])[(args as string[]).length - 1];
    expect(finalCommand).toContain(
      "cat > /work/generated.spec.ts <<'__SBX_TMPFS_EOF_BOUNDARY_DO_NOT_USE__'",
    );
    expect(finalCommand).toContain(specCode);
    expect(finalCommand).toContain(
      'pnpm jest /work/generated.spec.ts --rootDir=/repo',
    );
    // 사용자 명령은 prelude 다음에 와야 함.
    const heredocEnd = finalCommand.lastIndexOf(
      '__SBX_TMPFS_EOF_BOUNDARY_DO_NOT_USE__',
    );
    const userCmdIdx = finalCommand.indexOf('pnpm jest');
    expect(userCmdIdx).toBeGreaterThan(heredocEnd);
  });

  it('tmpfsFiles 여러 개 → 순서대로 HEREDOC 누적 + 사용자 command 마지막', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({
      command: 'run-tests',
      hostMountPath: '/tmp/repo',
      tmpfsFiles: [
        { containerPath: '/work/a.ts', content: 'A' },
        { containerPath: '/work/b.ts', content: 'B' },
      ],
    });

    const [, args] = mockSpawn.mock.calls[0];
    const finalCommand = (args as string[])[(args as string[]).length - 1];
    const aIdx = finalCommand.indexOf('cat > /work/a.ts');
    const bIdx = finalCommand.indexOf('cat > /work/b.ts');
    const cmdIdx = finalCommand.lastIndexOf('run-tests');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
    expect(cmdIdx).toBeGreaterThan(bIdx);
  });

  it('tmpfsSize custom → --tmpfs /work:size=32m,exec', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({
      command: 'cmd',
      hostMountPath: '/tmp/repo',
      tmpfsFiles: [{ containerPath: '/work/x', content: 'x' }],
      tmpfsSize: '32m',
    });

    const [, args] = mockSpawn.mock.calls[0];
    const tmpfsIdx = (args as string[]).indexOf('--tmpfs');
    expect((args as string[])[tmpfsIdx + 1]).toBe('/work:size=32m,exec');
  });

  it('tmpfs 사용 시 mountMode default ro 그대로 유지 (audit codex P1)', () => {
    const child = makeChild({ exitCode: 0 });
    mockSpawn.mockReturnValue(child as any);

    runner.run({
      command: 'cmd',
      hostMountPath: '/tmp/repo',
      tmpfsFiles: [{ containerPath: '/work/x', content: 'x' }],
    });

    const [, args] = mockSpawn.mock.calls[0];
    const vArgs = (args as string[]).filter((_, i, a) => a[i - 1] === '-v');
    expect(vArgs[0]).toBe('/tmp/repo:/repo:ro');
  });

  it('content 에 HEREDOC marker 포함 → UNSAFE_TMPFS_CONTENT throw', async () => {
    await expect(
      runner.run({
        command: 'cmd',
        hostMountPath: '/tmp/repo',
        tmpfsFiles: [
          {
            containerPath: '/work/x',
            content: 'leading\n__SBX_TMPFS_EOF_BOUNDARY_DO_NOT_USE__\ntrailing',
          },
        ],
      }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.UNSAFE_TMPFS_CONTENT,
    });
  });

  it('containerPath 가 /work/ 하위가 아님 → INVALID_REQUEST throw', async () => {
    await expect(
      runner.run({
        command: 'cmd',
        hostMountPath: '/tmp/repo',
        tmpfsFiles: [{ containerPath: '/etc/passwd', content: 'x' }],
      }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.INVALID_REQUEST,
    });
  });

  it('containerPath 가 /work 정확히 (디렉터리 자체) → INVALID_REQUEST throw', async () => {
    await expect(
      runner.run({
        command: 'cmd',
        hostMountPath: '/tmp/repo',
        tmpfsFiles: [{ containerPath: '/work', content: 'x' }],
      }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.INVALID_REQUEST,
    });
  });

  it('containerPath 에 셸 메타문자 포함 → INVALID_REQUEST throw', async () => {
    await expect(
      runner.run({
        command: 'cmd',
        hostMountPath: '/tmp/repo',
        tmpfsFiles: [{ containerPath: '/work/x;rm -rf /', content: 'x' }],
      }),
    ).rejects.toMatchObject({
      sandboxErrorCode: SandboxErrorCode.INVALID_REQUEST,
    });
  });
});
