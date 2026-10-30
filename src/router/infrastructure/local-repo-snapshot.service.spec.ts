import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  extractRepoSnapshot,
  removeOrphanRepoSnapshots,
} from '../../agent/code-reviewer/infrastructure/repo-snapshot';
import { LocalRepoSnapshotService } from './local-repo-snapshot.service';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../agent/code-reviewer/infrastructure/repo-snapshot', () => ({
  extractRepoSnapshot: jest.fn(),
  removeOrphanRepoSnapshots: jest.fn(),
  REPO_SNAPSHOT_MAX_EXTRACTED_BYTES: 536_870_912,
}));

const { spawn } = jest.requireMock('node:child_process') as {
  spawn: jest.Mock;
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
    spawn
      .mockReset()
      .mockImplementation((_command: string, argumentsList: string[]) => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill: jest.Mock;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = jest.fn();
        let output = '/private/tmp/pa-chat-context\n';
        if (argumentsList.includes('archive')) {
          archiveCount += 1;
          output = 'archive bytes';
        } else if (argumentsList.includes('HEAD')) {
          output = `${head}\n`;
        }
        setImmediate(() => {
          child.stdout.end(output);
          child.emit('close', 0);
        });
        return child;
      });
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
    const originalSpawn = spawn.getMockImplementation();
    spawn.mockImplementation(
      (command: string, argumentsList: string[], options: unknown) => {
        if (argumentsList.includes('archive')) {
          head = 'commit-two';
        }
        return originalSpawn?.(command, argumentsList, options);
      },
    );

    const snapshot = await service.acquire();

    expect(snapshot).not.toBeNull();
    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['archive', 'commit-one']),
      expect.any(Object),
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
    const originalSpawn = spawn.getMockImplementation();
    spawn.mockImplementation(
      (command: string, argumentsList: string[], options: unknown) => {
        if (argumentsList.includes('--show-toplevel')) {
          const child = new EventEmitter() as EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
          };
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          setImmediate(() => child.emit('close', 128));
          return child;
        }
        return originalSpawn?.(command, argumentsList, options);
      },
    );

    const snapshot = await service.acquire();

    expect(snapshot).toBeNull();
    expect(archiveCount).toBe(0);
  });

  it('1MB 가 넘는 git archive 스트림도 청크로 받는다', async () => {
    const originalSpawn = spawn.getMockImplementation();
    spawn.mockImplementation(
      (command: string, argumentsList: string[], options: unknown) => {
        if (argumentsList.includes('archive')) {
          archiveCount += 1;
          const child = new EventEmitter() as EventEmitter & {
            stdout: PassThrough;
            stderr: PassThrough;
            kill: jest.Mock;
          };
          child.stdout = new PassThrough();
          child.stderr = new PassThrough();
          child.kill = jest.fn();
          setImmediate(() => {
            child.stdout.write(Buffer.alloc(600_000));
            child.stdout.end(Buffer.alloc(600_000));
            child.emit('close', 0);
          });
          return child;
        }
        return originalSpawn?.(command, argumentsList, options);
      },
    );

    const snapshot = await service.acquire();

    expect(snapshot).not.toBeNull();
    expect(extract).toHaveBeenCalledWith({
      tarball: expect.objectContaining({ length: 1_200_000 }),
    });
    snapshot?.release();
    await service.onModuleDestroy();
  });

  it('git 자식에 앱 환경변수를 전달하지 않고 시작 때 죽은 PID 사본을 치운다', async () => {
    await service.onApplicationBootstrap();
    const snapshot = await service.acquire();

    expect(removeOrphans).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.any(Array),
      expect.objectContaining({
        env: expect.not.objectContaining({ DATABASE_URL: expect.anything() }),
      }),
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
