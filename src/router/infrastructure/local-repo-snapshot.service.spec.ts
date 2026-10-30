import {
  extractRepoSnapshot,
  removeOrphanRepoSnapshots,
} from '../../agent/code-reviewer/infrastructure/repo-snapshot';
import { LocalRepoSnapshotService } from './local-repo-snapshot.service';

jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
jest.mock('../../agent/code-reviewer/infrastructure/repo-snapshot', () => ({
  extractRepoSnapshot: jest.fn(),
  removeOrphanRepoSnapshots: jest.fn(),
  REPO_SNAPSHOT_MAX_EXTRACTED_BYTES: 536_870_912,
}));

const { execFile } = jest.requireMock('node:child_process') as {
  execFile: jest.Mock;
};

type ExecFileCallback = (
  error: Error | null,
  result?: { stdout: Buffer; stderr: Buffer },
) => void;

// promisify(execFile) 가 받는 콜백 모양으로 git 출력을 돌려준다.
const respond = (callback: ExecFileCallback, output: string | Buffer): void => {
  setImmediate(() =>
    callback(null, { stdout: Buffer.from(output), stderr: Buffer.alloc(0) }),
  );
};
const extract = extractRepoSnapshot as jest.Mock;
const removeOrphans = removeOrphanRepoSnapshots as jest.Mock;

describe('LocalRepoSnapshotService', () => {
  let head: string;
  let archiveCount: number;
  let disposeFunctions: jest.Mock[];
  let service: LocalRepoSnapshotService;

  beforeEach(() => {
    head = 'commit-one';
    archiveCount = 0;
    disposeFunctions = [];
    execFile
      .mockReset()
      .mockImplementation(
        (
          _command: string,
          argumentsList: string[],
          _options: unknown,
          callback: ExecFileCallback,
        ) => {
          if (argumentsList.includes('archive')) {
            archiveCount += 1;
            respond(callback, 'archive bytes');
            return;
          }
          if (argumentsList.includes('HEAD')) {
            respond(callback, `${head}\n`);
            return;
          }
          respond(callback, '/private/tmp/pa-chat-context\n');
        },
      );
    extract.mockReset().mockImplementation(async () => {
      const dispose = jest.fn().mockResolvedValue(undefined);
      disposeFunctions.push(dispose);
      return { root: `/tmp/snapshot-${disposeFunctions.length}`, dispose };
    });
    removeOrphans.mockReset().mockResolvedValue([]);
    service = new LocalRepoSnapshotService();
  });

  it('같은 HEAD 에서는 git archive 를 다시 부르지 않는다', async () => {
    const first = await service.acquire();
    const second = await service.acquire();

    expect(first?.root).toBe(second?.root);
    expect(archiveCount).toBe(1);
    first?.release();
    second?.release();
    await service.onModuleDestroy();
  });

  it('HEAD 조회 직후 브랜치가 이동해도 조회한 커밋으로 아카이브를 고정한다', async () => {
    const original = execFile.getMockImplementation();
    execFile.mockImplementation(
      (
        command: string,
        argumentsList: string[],
        options: unknown,
        callback: ExecFileCallback,
      ) => {
        if (argumentsList.includes('archive')) {
          head = 'commit-two';
        }
        return original?.(command, argumentsList, options, callback);
      },
    );

    const snapshot = await service.acquire();

    expect(snapshot).not.toBeNull();
    expect(execFile).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['archive', 'commit-one']),
      expect.any(Object),
      expect.any(Function),
    );
    snapshot?.release();
    await service.onModuleDestroy();
  });

  it('HEAD 교체 후 사용 중인 옛 사본을 마지막 release 까지 남긴다', async () => {
    const first = await service.acquire();
    head = 'commit-two';
    const second = await service.acquire();

    expect(second?.root).not.toBe(first?.root);
    expect(disposeFunctions[0]).not.toHaveBeenCalled();
    first?.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeFunctions[0]).toHaveBeenCalledTimes(1);
    second?.release();
    await service.onModuleDestroy();
  });

  it('한 답이 살아 있는 동안 HEAD 가 두 번 바뀌어도 그 사본을 남긴다', async () => {
    const first = await service.acquire();
    head = 'commit-two';
    const second = await service.acquire();
    head = 'commit-three';
    const third = await service.acquire();

    expect(disposeFunctions[0]).not.toHaveBeenCalled();
    first?.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeFunctions[0]).toHaveBeenCalledTimes(1);
    second?.release();
    third?.release();
    await service.onModuleDestroy();
  });

  it('동시에 두 답이 요청해도 아카이브는 한 번만 만든다', async () => {
    const [first, second] = await Promise.all([
      service.acquire(),
      service.acquire(),
    ]);

    expect(archiveCount).toBe(1);
    expect(first?.root).toBe(second?.root);
    first?.release();
    second?.release();
    await service.onModuleDestroy();
  });

  it('git 레포가 아니면 null 을 반환한다', async () => {
    const original = execFile.getMockImplementation();
    execFile.mockImplementation(
      (
        command: string,
        argumentsList: string[],
        options: unknown,
        callback: ExecFileCallback,
      ) => {
        if (argumentsList.includes('--show-toplevel')) {
          setImmediate(() => callback(new Error('not a git repository')));
          return;
        }
        return original?.(command, argumentsList, options, callback);
      },
    );

    const snapshot = await service.acquire();

    expect(snapshot).toBeNull();
    expect(archiveCount).toBe(0);
  });

  it('git 출력 상한을 해제 상한으로 걸고, 1MB 가 넘는 아카이브도 받는다', async () => {
    const original = execFile.getMockImplementation();
    execFile.mockImplementation(
      (
        command: string,
        argumentsList: string[],
        options: unknown,
        callback: ExecFileCallback,
      ) => {
        if (argumentsList.includes('archive')) {
          archiveCount += 1;
          respond(callback, Buffer.alloc(1_200_000));
          return;
        }
        return original?.(command, argumentsList, options, callback);
      },
    );

    const snapshot = await service.acquire();

    expect(execFile).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['archive']),
      expect.objectContaining({ encoding: 'buffer', maxBuffer: 536_870_912 }),
      expect.any(Function),
    );
    expect(extract).toHaveBeenCalledWith({
      tarball: expect.objectContaining({ length: 1_200_000 }),
    });
    snapshot?.release();
    await service.onModuleDestroy();
  });

  it('release 를 두 번 불러도 한 번만 반영해 다른 답이 쓰는 사본을 지우지 않는다', async () => {
    const first = await service.acquire();
    const second = await service.acquire();
    head = 'commit-two';
    const third = await service.acquire();

    first?.release();
    first?.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeFunctions[0]).not.toHaveBeenCalled();
    second?.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(disposeFunctions[0]).toHaveBeenCalledTimes(1);
    third?.release();
    await service.onModuleDestroy();
  });

  it('git 자식에 앱 환경변수를 전달하지 않고 시작 때 죽은 PID 사본을 치운다', async () => {
    await service.onApplicationBootstrap();
    const snapshot = await service.acquire();

    expect(removeOrphans).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      'git',
      expect.any(Array),
      expect.objectContaining({
        env: expect.not.objectContaining({ DATABASE_URL: expect.anything() }),
      }),
      expect.any(Function),
    );
    snapshot?.release();
    await service.onModuleDestroy();
  });

  it('종료 때 사용 중인 현재·옛 사본을 모두 정리한다', async () => {
    await service.acquire();
    head = 'commit-two';
    await service.acquire();

    await service.onModuleDestroy();

    expect(disposeFunctions[0]).toHaveBeenCalledTimes(1);
    expect(disposeFunctions[1]).toHaveBeenCalledTimes(1);
  });
});
