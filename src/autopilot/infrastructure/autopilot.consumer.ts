import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { AUTOPILOT_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { SystemWakeGuard } from '../../common/system/system-wake-guard.service';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { AutopilotOrchestrator } from '../application/autopilot.orchestrator';
import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import { MUTUALLY_EXCLUSIVE_AUTOPILOT_GROUPS } from '../domain/autopilot.playbook-defaults';
import {
  AUTOPILOT_CRON_QUEUE,
  AutopilotJobData,
} from '../domain/autopilot.type';

// 단일 consumer — job.name(=groupKey)으로 그룹 entries 를 찾아 orchestrator.runGroup 에 위임.
// 실패 시 owner DM 통지(fire-and-forget) 후 rethrow → BullMQ 재시도.
@Processor(AUTOPILOT_CRON_QUEUE, AUTOPILOT_WORKER_OPTIONS)
export class AutopilotConsumer extends WorkerHost {
  private readonly logger = new Logger(AutopilotConsumer.name);
  // 배타 그룹의 실행을 잇는 사슬. worker 는 한 프로세스 안에서 도므로 프로세스 안의 사슬이면
  // 충분하다(BullMQ 동시 처리도 같은 worker 인스턴스 안에서 일어난다). 인스턴스를 여러 개
  // 띄우게 되면 이 자리는 Redis 잠금으로 바꿔야 한다.
  private exclusiveChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly orchestrator: AutopilotOrchestrator,
    private readonly wakeGuard: SystemWakeGuard,
    private readonly modelRouter: ModelRouterUsecase,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<AutopilotJobData>): Promise<void> {
    const groupKey = job.name;
    const { ownerSlackUserId, target } = job.data;
    const entries = AUTOPILOT_PLAYBOOK.filter(
      (entry) =>
        (entry.digestGroup ?? entry.id) === groupKey &&
        entry.trigger.kind === 'CRON',
    );
    if (entries.length === 0) {
      const message = `미등록 cron group '${groupKey}' — 플레이북 등록 누락(구성 오류). 실행 스킵됨.`;
      this.logger.error(
        `플레이북에 등록되지 않은 group '${groupKey}' — 실행할 task 없음`,
      );
      this.notifyOwnerFailure(ownerSlackUserId, groupKey, message);
      return;
    }
    // 절전에서 깨어난 직후면 codex 백엔드가 준비될 때까지 확인한 뒤 실행한다 — 미준비 상태로 실행돼
    // "모델 호출 실패 (CHATGPT)" 로 브리핑이 통째로 실패하는 것을 방지. 평상시엔 즉시 통과한다.
    await this.wakeGuard.waitUntilReady(() =>
      this.modelRouter.probeReadiness(),
    );
    try {
      // job.id 를 슬롯 식별자로 넘긴다 — stalled 재큐는 같은 job 을 다시 처리하므로 id 가
      // 같고, 다음 스케줄 슬롯은 새 job = 새 id 라 재진입 차단이 슬롯 밖으로 번지지 않는다.
      const runGroup = (): Promise<void> =>
        this.orchestrator.runGroup(
          groupKey,
          entries,
          ownerSlackUserId,
          target,
          job.id,
        );
      if (MUTUALLY_EXCLUSIVE_AUTOPILOT_GROUPS.includes(groupKey)) {
        await this.runExclusively(runGroup);
      } else {
        await runGroup();
      }
    } catch (error) {
      this.logger.error(
        `Autopilot[${groupKey}] 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, groupKey, error);
      throw error;
    }
  }

  // 배타 그룹을 앞선 배타 실행 뒤로 줄 세운다. 앞선 실행이 실패해도 뒤를 막지 않는다 —
  // 사슬이 rejected 로 남으면 그 뒤의 모든 배타 그룹이 영영 실행되지 않는다.
  private async runExclusively<T>(task: () => Promise<T>): Promise<T> {
    const result = this.exclusiveChain.then(task, task);
    this.exclusiveChain = result.then(
      () => undefined,
      () => undefined,
    );
    return await result;
  }

  private notifyOwnerFailure(
    ownerSlackUserId: string,
    groupKey: string,
    error: unknown,
  ): void {
    if (!this.notificationPublisher) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.notificationPublisher.publishCronFailure({
      cronName: `Autopilot:${groupKey}`,
      ownerSlackUserId,
      errorMessage,
    });
  }
}
