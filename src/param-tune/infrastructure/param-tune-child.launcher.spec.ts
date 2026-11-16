import { EventEmitter } from 'node:events';
import { join } from 'node:path';

import type * as LauncherModule from './param-tune-child.launcher';

const mockSpawn = jest.fn();
const mockFs = {
  mkdirSync: jest.fn<unknown, unknown[]>(() => undefined),
  openSync: jest.fn<unknown, unknown[]>(() => 42),
  closeSync: jest.fn<unknown, unknown[]>(() => undefined),
  readFileSync: jest.fn<unknown, unknown[]>(() => 'a\n\nb\n'),
  existsSync: jest.fn<unknown, unknown[]>(() => true),
};

jest.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));
jest.mock('node:fs', () => ({
  mkdirSync: (...a: unknown[]) => mockFs.mkdirSync(...a),
  openSync: (...a: unknown[]) => mockFs.openSync(...a),
  closeSync: (...a: unknown[]) => mockFs.closeSync(...a),
  readFileSync: (...a: unknown[]) => mockFs.readFileSync(...a),
  existsSync: (...a: unknown[]) => mockFs.existsSync(...a),
}));

// jest setup(internal-terms)이 *.autopilot-task.ts 를 미리 require 하며 이 모듈을 실제 fs 로 캐시한다.
// 위 mock 이 먹도록 새 레지스트리에서 다시 불러온다.
let findRepoRoot: typeof LauncherModule.findRepoRoot;
let ParamTuneChildLauncher: typeof LauncherModule.ParamTuneChildLauncher;
jest.isolateModules(() => {
  const loaded = jest.requireActual<typeof LauncherModule>(
    './param-tune-child.launcher',
  );
  findRepoRoot = loaded.findRepoRoot;
  ParamTuneChildLauncher = loaded.ParamTuneChildLauncher;
});

class FakeChild extends EventEmitter {
  killed: string[] = [];
  exitCode: number | null = null;
  kill(signal: string): boolean {
    this.killed.push(signal);
    return true;
  }
}

const input = {
  args: ['--run-id', '1'],
  logPath: '/x/logs/a.log',
  timeoutMs: 1000,
};

describe('findRepoRoot', () => {
  it('package.json 과 scripts/parameter-tune.ts 가 함께 있는 첫 상위 디렉터리를 찾는다', () => {
    const exists = (path: string): boolean =>
      path === '/r/package.json' || path === '/r/scripts/parameter-tune.ts';
    expect(findRepoRoot('/r/dist/src/param-tune/infrastructure', exists)).toBe(
      '/r',
    );
  });

  it('6단계 안에 없으면 null', () => {
    expect(findRepoRoot('/a/b/c', () => false)).toBeNull();
  });
});

describe('ParamTuneChildLauncher', () => {
  let child: FakeChild;
  const launcher = new ParamTuneChildLauncher();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    child = new FakeChild();
    mockSpawn.mockReturnValue(child);
  });
  afterEach(() => jest.useRealTimers());

  it('상대 logPath 는 레포 루트 기준으로 연다', async () => {
    const promise = launcher.run({ ...input, logPath: 'logs/a.log' });
    child.emit('exit', 0, null);
    await promise;
    // 이 spec 은 launcher 와 같은 디렉터리라 existsSync=true 에서 루트가 __dirname 이다.
    expect(mockFs.openSync).toHaveBeenCalledWith(
      join(__dirname, 'logs/a.log'),
      'a',
    );
  });

  it('exit 0 이면 EXITED 와 로그 꼬리를 돌려준다', async () => {
    const promise = launcher.run(input);
    child.emit('exit', 0, null);
    await expect(promise).resolves.toEqual({
      kind: 'EXITED',
      code: 0,
      tail: 'a\nb',
    });
    expect(mockFs.closeSync).toHaveBeenCalledWith(42);
    const options = mockSpawn.mock.calls[0][2] as Record<string, unknown>;
    expect(options.stdio).toEqual(['ignore', 42, 42]);
    expect(options).not.toHaveProperty('env');
  });

  it('타임아웃이면 SIGTERM 후 10초 뒤 SIGKILL, 종료 뒤 TIMEOUT', async () => {
    const promise = launcher.run(input);
    jest.advanceTimersByTime(1000);
    expect(child.killed).toEqual(['SIGTERM']);
    jest.advanceTimersByTime(10_000);
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL']);
    child.emit('exit', null, 'SIGKILL');
    await expect(promise).resolves.toEqual({ kind: 'TIMEOUT', tail: 'a\nb' });
  });

  it('SIGTERM 에 정상 종료하면 SIGKILL 을 보내지 않는다', async () => {
    const promise = launcher.run(input);
    jest.advanceTimersByTime(1000);
    child.emit('exit', null, 'SIGTERM');
    await expect(promise).resolves.toMatchObject({ kind: 'TIMEOUT' });
    jest.advanceTimersByTime(20_000);
    expect(child.killed).toEqual(['SIGTERM']);
  });

  it('error 이벤트(ENOENT)면 SPAWN_FAILED', async () => {
    const promise = launcher.run(input);
    child.emit('error', new Error('spawn ENOENT'));
    await expect(promise).resolves.toEqual({
      kind: 'SPAWN_FAILED',
      message: 'spawn ENOENT',
    });
  });

  it('레포 루트를 못 찾으면 spawn 없이 SPAWN_FAILED', async () => {
    mockFs.existsSync.mockReturnValue(false);
    const result = await launcher.run(input);
    expect(result.kind).toBe('SPAWN_FAILED');
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
