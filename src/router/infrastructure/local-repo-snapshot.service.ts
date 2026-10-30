import { spawn } from 'node:child_process';

import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';

import {
  extractRepoSnapshot,
  removeOrphanRepoSnapshots,
  REPO_SNAPSHOT_MAX_EXTRACTED_BYTES,
} from '../../agent/code-reviewer/infrastructure/repo-snapshot';
import { buildSafeChildEnv } from '../../model-router/infrastructure/cli-process.util';

interface SnapshotLease {
  root: string;
  release: () => void;
}

interface CachedSnapshot {
  commit: string;
  root: string;
  dispose: () => Promise<void>;
  users: number;
  retired: boolean;
}

interface GitResult {
  output: Buffer;
}

@Injectable()
export class LocalRepoSnapshotService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LocalRepoSnapshotService.name);
  private repositoryRootPromise?: Promise<string | null>;
  private current?: CachedSnapshot;
  private readonly snapshots = new Set<CachedSnapshot>();
  private pending?: Promise<CachedSnapshot | null>;

  async onApplicationBootstrap(): Promise<void> {
    try {
      await removeOrphanRepoSnapshots();
    } catch (error: unknown) {
      this.logger.warn(`오래된 레포 사본 정리 실패: ${String(error)}`);
    }
  }

  async acquire(): Promise<SnapshotLease | null> {
    const repositoryRoot = await this.getRepositoryRoot();
    if (!repositoryRoot) {
      return null;
    }
    try {
      const head = (
        await this.runGit(
          ['-C', repositoryRoot, 'rev-parse', 'HEAD'],
          repositoryRoot,
        )
      ).output
        .toString()
        .trim();
      if (this.current?.commit === head) {
        return this.lease(this.current);
      }
      // 같은 HEAD 를 기다리는 답은 생성 중인 아카이브를 공유한다.
      if (!this.pending) {
        const creation = this.createSnapshot(repositoryRoot, head);
        this.pending = creation;
        void creation.then(
          () => {
            if (this.pending === creation) {
              this.pending = undefined;
            }
          },
          () => {
            if (this.pending === creation) {
              this.pending = undefined;
            }
          },
        );
      }
      const snapshot = await this.pending;
      if (!snapshot) {
        return null;
      }
      if (snapshot.commit !== head) {
        return await this.acquire();
      }
      return this.lease(snapshot);
    } catch (error: unknown) {
      this.logger.warn(`레포 사본 준비 실패: ${String(error)}`);
      return null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pending) {
      await this.pending.catch((error: unknown) => {
        this.logger.warn(`종료 중 레포 사본 생성 실패: ${String(error)}`);
      });
    }
    await Promise.all(
      [...this.snapshots].map((snapshot) => snapshot.dispose()),
    );
    this.snapshots.clear();
    this.current = undefined;
  }

  private async getRepositoryRoot(): Promise<string | null> {
    if (!this.repositoryRootPromise) {
      this.repositoryRootPromise = this.runGit(
        ['rev-parse', '--show-toplevel'],
        process.cwd(),
      )
        .then((result) => result.output.toString().trim())
        .catch((error: unknown) => {
          this.logger.warn(`로컬 git 레포 조회 실패: ${String(error)}`);
          return null;
        });
    }
    return await this.repositoryRootPromise;
  }

  private async createSnapshot(
    repositoryRoot: string,
    head: string,
  ): Promise<CachedSnapshot | null> {
    const archive = await this.runGit(
      [
        '-C',
        repositoryRoot,
        'archive',
        '--format=tar.gz',
        '--prefix=repo/',
        head,
      ],
      repositoryRoot,
    );
    const extracted = await extractRepoSnapshot({ tarball: archive.output });
    const snapshot: CachedSnapshot = {
      commit: head,
      root: extracted.root,
      dispose: extracted.dispose,
      users: 0,
      retired: false,
    };
    const previous = this.current;
    this.current = snapshot;
    this.snapshots.add(snapshot);
    if (previous) {
      previous.retired = true;
      this.disposeUnused(previous);
    }
    return snapshot;
  }

  private lease(snapshot: CachedSnapshot): SnapshotLease {
    snapshot.users += 1;
    let released = false;
    return {
      root: snapshot.root,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        snapshot.users -= 1;
        this.disposeUnused(snapshot);
      },
    };
  }

  private disposeUnused(snapshot: CachedSnapshot): void {
    if (!snapshot.retired || snapshot.users > 0) {
      return;
    }
    this.snapshots.delete(snapshot);
    void snapshot.dispose().catch((error: unknown) => {
      this.logger.warn(`레포 사본 정리 실패: ${String(error)}`);
    });
  }

  private runGit(argumentsList: string[], cwd: string): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', argumentsList, {
        cwd,
        env: buildSafeChildEnv({ cwd }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = [];
      let outputBytes = 0;
      let stderr = '';
      let settled = false;
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > REPO_SNAPSHOT_MAX_EXTRACTED_BYTES) {
          child.kill();
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString().slice(0, 1024);
      });
      child.on('error', (error: Error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (outputBytes > REPO_SNAPSHOT_MAX_EXTRACTED_BYTES) {
          reject(new Error('git archive 크기 제한 초과'));
          return;
        }
        if (code !== 0) {
          reject(new Error(`git 종료 코드 ${code}: ${stderr.trim()}`));
          return;
        }
        resolve({ output: Buffer.concat(chunks) });
      });
    });
  }
}
