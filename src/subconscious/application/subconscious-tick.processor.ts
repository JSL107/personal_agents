import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import {
  SUBCONSCIOUS_TICK_QUEUE,
  SubconsciousTickJobData,
} from '../domain/subconscious-tick.type';
import { SubconsciousEngine } from './subconscious.engine';

// tick job → SubconsciousEngine.runTick(owner, now).
// 실패 시 rethrow → BullMQ 재시도 (attempts=2, exponential backoff).
@Processor(SUBCONSCIOUS_TICK_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class SubconsciousTickProcessor extends WorkerHost {
  private readonly logger = new Logger(SubconsciousTickProcessor.name);

  constructor(private readonly engine: SubconsciousEngine) {
    super();
  }

  async process(job: Job<SubconsciousTickJobData>): Promise<void> {
    const { ownerSlackUserId } = job.data;
    try {
      await this.engine.runTick(ownerSlackUserId, Date.now());
    } catch (error) {
      this.logger.error(
        `SubconsciousTick 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      throw error;
    }
  }
}
