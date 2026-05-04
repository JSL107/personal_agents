import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AnalyzePrConventionUsecase } from '../../agent/be-fix/application/analyze-pr-convention.usecase';
import { BeFixException } from '../../agent/be-fix/domain/be-fix.exception';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { BE_FIX_QUEUE, BeFixJobData } from '../domain/webhook.type';

// GitHub pull_request.opened webhook 으로 enqueued 된 BE-FIX 작업을 직렬 처리.
// concurrency=1 로 LLM 동시 호출 방지 — impact-report consumer 와 동일 패턴.
@Processor(BE_FIX_QUEUE, { concurrency: 1 })
export class WebhookBeFixConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookBeFixConsumer.name);

  constructor(
    private readonly analyzePrConventionUsecase: AnalyzePrConventionUsecase,
  ) {
    super();
  }

  async process(job: Job<BeFixJobData>): Promise<void> {
    const { prRef, slackUserId } = job.data;
    this.logger.log(`Webhook BE-Fix 시작 — ${prRef}`);
    try {
      await this.analyzePrConventionUsecase.execute({
        prRef,
        slackUserId,
        triggerType: TriggerType.WEBHOOK,
      });
      this.logger.log(`Webhook BE-Fix 완료 — ${prRef}`);
    } catch (error: unknown) {
      // codex P2 — 도메인 BAD_REQUEST (EMPTY_PR_REF / INVALID_PR_REF / DIFF_TOO_LARGE 등) 는
      // 영구 실패라 재시도 무의미. swallow.
      if (
        error instanceof BeFixException &&
        error.status === DomainStatus.BAD_REQUEST
      ) {
        this.logger.warn(
          `Webhook BE-Fix skip — ${error.beFixErrorCode}: ${error.message}`,
        );
        return;
      }
      this.logger.error(
        `Webhook BE-Fix 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
