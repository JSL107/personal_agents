import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { AUTOPILOT_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { SystemWakeGuard } from '../../common/system/system-wake-guard.service';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { AutopilotOrchestrator } from '../application/autopilot.orchestrator';
import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import {
  AUTOPILOT_CRON_QUEUE,
  AutopilotJobData,
} from '../domain/autopilot.type';

// 단일 consumer — job.name(=groupKey)으로 그룹 entries 를 찾아 orchestrator.runGroup 에 위임.
// 실패 시 owner DM 통지(fire-and-forget) 후 rethrow → BullMQ 재시도.
@Processor(AUTOPILOT_CRON_QUEUE, AUTOPILOT_WORKER_OPTIONS)
export class AutopilotConsumer extends WorkerHost {
  private readonly logger = new Logger(AutopilotConsumer.name);

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
    const entries = AUTOPILOT_PLAYBOOK.filter(
      (entry) =>
        (entry.digestGroup ?? entry.id) === groupKey &&
        entry.trigger.kind === 'CRON',
    );
    if (entries.length === 0) {
      this.logger.error(`Autopilot — 미등록 group 무시: ${groupKey}`);
      return;
    }
    const { ownerSlackUserId, target } = job.data;
    // 절전에서 깨어난 직후면 codex 백엔드가 준비될 때까지 확인한 뒤 실행한다 — 미준비 상태로 실행돼
    // "모델 호출 실패 (CHATGPT)" 로 브리핑이 통째로 실패하는 것을 방지. 평상시엔 즉시 통과한다.
    await this.wakeGuard.waitUntilReady(() =>
      this.modelRouter.probeReadiness(),
    );
    try {
      await this.orchestrator.runGroup(
        groupKey,
        entries,
        ownerSlackUserId,
        target,
      );
    } catch (error) {
      this.logger.error(
        `Autopilot[${groupKey}] 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, groupKey, error);
      throw error;
    }
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
