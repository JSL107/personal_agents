import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  // 아직 release 하지 않은 lease 표식. 비어야 교체된 사본을 지울 수 있다.
  activeLeases: Set<symbol>;
  retired: boolean;
}

interface CreateSnapshotInput {
  repositoryRoot: string;
  head: string;
}

interface RunGitInput {
  argumentsList: string[];
  cwd: string;
}

// 대화 답변이 읽을 이대리 레포 사본. 실행 중 레포에서 `git archive` 로 커밋된 파일만 꺼낸다 — 레포 폴더를
// 그대로 열면 gitignore 대상(.env)까지 모델이 읽는다. 커밋당 한 번 만들고, 교체된 사본은 쓰는 답이 모두
// 끝난 뒤 지운다.
@Injectable()
export class LocalRepoSnapshotService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LocalRepoSnapshotService.name);
  private repositoryRootPromise?: Promise<string | null>;
  private current?: CachedSnapshot;
  private readonly snapshots = new Set<CachedSnapshot>();
  private pending?: Promise<CachedSnapshot>;

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
      const head = await this.readHead(repositoryRoot);
      if (this.current?.commit === head) {
        return this.lease(this.current);
      }
      // 같은 HEAD 를 기다리는 답은 생성 중인 아카이브를 공유한다. 끝나면(성공·실패 모두) 비워 다음 HEAD 를 받는다.
      this.pending ??= this.createSnapshot({ repositoryRoot, head }).finally(
        () => {
          this.pending = undefined;
        },
      );
      const snapshot = await this.pending;
      // 기다리는 사이 HEAD 가 또 바뀌어 다른 커밋의 사본이 만들어졌으면 처음부터 다시 맞춘다.
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
    this.repositoryRootPromise ??= this.runGit({
      argumentsList: ['rev-parse', '--show-toplevel'],
      cwd: process.cwd(),
    })
      .then((output) => output.toString().trim())
      .catch((error: unknown) => {
        this.logger.warn(`로컬 git 레포 조회 실패: ${String(error)}`);
        return null;
      });
    return await this.repositoryRootPromise;
  }

  private async readHead(repositoryRoot: string): Promise<string> {
    const output = await this.runGit({
      argumentsList: ['-C', repositoryRoot, 'rev-parse', 'HEAD'],
      cwd: repositoryRoot,
    });
    return output.toString().trim();
  }

  private async createSnapshot({
    repositoryRoot,
    head,
  }: CreateSnapshotInput): Promise<CachedSnapshot> {
    // 조회한 커밋 해시로 고정한다 — HEAD 이름으로 꺼내면 조회와 아카이브 사이에 커밋이 바뀔 수 있다.
    const tarball = await this.runGit({
      argumentsList: [
        '-C',
        repositoryRoot,
        'archive',
        '--format=tar.gz',
        '--prefix=repo/',
        head,
      ],
      cwd: repositoryRoot,
    });
    const extracted = await extractRepoSnapshot({ tarball });
    const snapshot: CachedSnapshot = {
      commit: head,
      root: extracted.root,
      dispose: extracted.dispose,
      activeLeases: new Set(),
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
    const leaseId = Symbol('repo-snapshot-lease');
    snapshot.activeLeases.add(leaseId);
    // Set.delete 는 처음 지울 때만 true 라, release 를 여러 번 불러도 한 번만 반영된다.
    const release = (): void => {
      if (snapshot.activeLeases.delete(leaseId)) {
        this.disposeUnused(snapshot);
      }
    };
    return { root: snapshot.root, release };
  }

  private disposeUnused(snapshot: CachedSnapshot): void {
    if (!snapshot.retired || snapshot.activeLeases.size > 0) {
      return;
    }
    this.snapshots.delete(snapshot);
    void snapshot.dispose().catch((error: unknown) => {
      this.logger.warn(`레포 사본 정리 실패: ${String(error)}`);
    });
  }

  // execFile 은 출력이 maxBuffer 를 넘으면 자식을 끊고 실패한다 — 압축 아카이브에도 해제 상한을 그대로 건다.
  // 자식 env 는 buildSafeChildEnv 로 앱 환경변수(DATABASE_URL·토큰)를 넘기지 않는다.
  private async runGit({ argumentsList, cwd }: RunGitInput): Promise<Buffer> {
    // promisify 를 호출 시점에 한다 — 모듈 로드 때 붙잡으면 테스트가 execFile 을 갈아끼울 수 없다.
    const { stdout } = await promisify(execFile)('git', argumentsList, {
      cwd,
      env: buildSafeChildEnv({ cwd }),
      encoding: 'buffer',
      maxBuffer: REPO_SNAPSHOT_MAX_EXTRACTED_BYTES,
    });
    return stdout;
  }
}
