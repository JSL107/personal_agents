import { Inject, Injectable, Logger } from '@nestjs/common';

import { diagnoseMemoryIndex } from '../domain/memory-index.analyzer';
import { vacuumMemoryIndex } from '../domain/memory-index.cleaner';
import {
  MemoryIndexSnapshot,
  VacuumOutcome,
} from '../domain/memory-index.type';
import {
  MEMORY_STORE_PORT,
  MemoryStorePort,
  MemoryVacuumState,
} from '../domain/port/memory-store.port';
import {
  MemoryVacuumOutcome,
  MemoryVacuumPort,
  RunMemoryVacuumInput,
} from '../domain/port/memory-vacuum.port';

// 기억 색인 청소의 조율 책임. 판정·변환은 도메인 순수 함수가 하고, 여기서는
// "무엇을 어떤 순서로, 무엇이 실패하면 멈추는가" 만 정한다.
@Injectable()
export class MemoryVacuumService implements MemoryVacuumPort {
  private readonly logger = new Logger(MemoryVacuumService.name);

  constructor(
    @Inject(MEMORY_STORE_PORT)
    private readonly store: MemoryStorePort,
  ) {}

  async run(input: RunMemoryVacuumInput): Promise<MemoryVacuumOutcome> {
    const snapshots = await this.store.loadSnapshots();
    const outcomes: VacuumOutcome[] = [];
    const failures: { project: string; reason: string }[] = [];

    for (const snapshot of snapshots) {
      const outcome = vacuumMemoryIndex(
        snapshot,
        diagnoseMemoryIndex(snapshot),
      );
      outcomes.push(outcome);
      if (!input.apply || outcome.nextIndexContent === null) {
        continue;
      }
      const failure = await this.applyOutcome(snapshot, outcome);
      if (failure !== null) {
        failures.push({ project: snapshot.project, reason: failure });
      }
    }

    if (input.apply) {
      await this.saveState(outcomes, snapshots.length);
    }
    return { outcomes, failures };
  }

  async lastState(): Promise<MemoryVacuumState | null> {
    return await this.store.loadState();
  }

  // 실태 기록이 실패해도 청소 자체는 성공이다 — 기록 실패로 예외를 던지면
  // 이미 끝난 청소가 실패한 회차로 보인다.
  private async saveState(
    outcomes: VacuumOutcome[],
    projectCount: number,
  ): Promise<void> {
    const cleanedCount = outcomes.reduce(
      (total, outcome) =>
        total + outcome.actions.reduce((sum, action) => sum + action.count, 0),
      0,
    );
    const pendingProjects = outcomes.filter(
      (outcome) => outcome.remainingOverflowBytes > 0,
    ).length;
    try {
      await this.store.saveState({
        ranAtIso: new Date().toISOString(),
        projectCount,
        cleanedCount,
        pendingProjects,
      });
    } catch (error) {
      this.logger.warn(`청소 실태 기록에 실패했습니다: ${String(error)}`);
    }
  }

  // 백업이 실패하면 쓰지 않는다 — 되돌릴 수 없는 쓰기 앞의 유일한 안전장치라,
  // 백업 없이 진행하면 잘못된 청소를 복구할 방법이 사라진다.
  private async applyOutcome(
    snapshot: MemoryIndexSnapshot,
    outcome: VacuumOutcome,
  ): Promise<string | null> {
    let backupPath: string;
    try {
      backupPath = await this.store.backup(snapshot);
    } catch (error) {
      this.logger.error(
        `[${snapshot.project}] 백업 실패로 청소를 건너뜁니다: ${String(error)}`,
      );
      return `백업 실패 — ${String(error)}`;
    }

    try {
      await this.store.writeIndex(snapshot, outcome.nextIndexContent as string);
      this.logger.log(
        `[${snapshot.project}] 색인 청소 완료 (백업 ${backupPath})`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `[${snapshot.project}] 색인 쓰기 실패: ${String(error)}`,
      );
      return `쓰기 실패 — ${String(error)}`;
    }
  }
}
