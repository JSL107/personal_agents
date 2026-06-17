import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { AutopilotOrchestrator } from '../application/autopilot.orchestrator';
import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import {
  AUTOPILOT_CRON_QUEUE,
  AutopilotJobData,
} from '../domain/autopilot.type';

// 단일 consumer — job.name(=groupKey)으로 그룹 entries 를 찾아 orchestrator.runGroup 에 위임.
// 실패 시 owner DM 통지(fire-and-forget) 후 rethrow → BullMQ 재시도.
@Processor(AUTOPILOT_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class AutopilotConsumer extends WorkerHost {
  private readonly logger = new Logger(AutopilotConsumer.name);

  constructor(
    private readonly orchestrator: AutopilotOrchestrator,
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
